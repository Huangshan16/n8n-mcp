import { MCPClient } from './mcp-client';
import { LLMClient, ChatMessage } from './llm-client';
import { HardwareComponent } from './hardware-components';
import { WorkflowDefinition, ConversationTurn } from './types';
import { AgentLogger, ValidationSummary } from './agent-logger';
import { buildArchitectSystemPrompt } from './prompts/architect-system';
import { selectPromptVariant } from './prompts/prompt-variants';
import { SimpleCache } from '../utils/simple-cache';
import { logger } from '../utils/logger';
import { ALLOWED_NODE_TYPES } from './allowed-node-types';
import type { ValidationResult } from './mcp-client';
import { randomUUID } from 'crypto';

export interface WorkflowRequest {
  sessionId?: string;
  userIntent: string;
  entities: Record<string, string>;
  hardwareComponents: HardwareComponent[];
  conversationHistory: ConversationTurn[];
}

export interface WorkflowResult {
  success: boolean;
  workflow?: WorkflowDefinition;
  validationResult?: {
    isValid: boolean;
    errors: { message: string }[];
  };
  iterations: number;
  reasoning: string;
}

export interface WorkflowArchitectOptions {
  maxIterations?: number;
  llmTimeoutMs?: number;
  cacheTtlSeconds?: number;
  promptVariant?: string;
}

export interface WorkflowGenerationOptions {
  maxIterations?: number;
}

const BASE_NODE_QUERIES = [
  'http request',
  'webhook',
  'schedule trigger',
  'if',
  'split in batches',
  'set',
];
const BASE_NODE_TYPES = [...ALLOWED_NODE_TYPES];

export class WorkflowArchitect {
  private maxIterations: number;
  private llmTimeoutMs: number;
  private cacheTtlSeconds: number;
  private cache: SimpleCache;
  private nodeContextCache: SimpleCache;
  private promptVariant?: string;
  private agentLogger = new AgentLogger();

  constructor(
    private llmClient: LLMClient,
    private mcpClient: MCPClient,
    options: WorkflowArchitectOptions = {}
  ) {
    this.maxIterations = options.maxIterations ?? 5;
    this.llmTimeoutMs = options.llmTimeoutMs ?? 30000;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 600;
    this.cache = new SimpleCache();
    this.nodeContextCache = new SimpleCache();
    this.promptVariant = options.promptVariant;
  }

  async generateWorkflow(
    request: WorkflowRequest,
    options: WorkflowGenerationOptions = {}
  ): Promise<WorkflowResult> {
    const cacheKey = JSON.stringify({ intent: request.userIntent, entities: request.entities });
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as WorkflowResult;
    }

    const sessionId = request.sessionId ?? 'unknown';
    const nodeContext = await this.buildNodeContext(request.hardwareComponents);
    const toolDescriptions = [
      'search_nodes: 搜索n8n节点',
      'get_node: 获取节点详细配置与typeVersion',
      'validate_workflow: 校验工作流JSON结构',
      'autofix_workflow: 尝试自动修复常见错误',
    ];
    const variant = selectPromptVariant(this.promptVariant, request.userIntent);
    const systemPrompt = `${buildArchitectSystemPrompt(
      request.hardwareComponents,
      toolDescriptions,
      ALLOWED_NODE_TYPES,
      variant
    )}\n\n# 节点上下文\n${nodeContext}`;
    const userMessage = this.buildUserMessage(request);

    let lastErrors: string[] = [];
    let reasoning = '';
    let workflow: WorkflowDefinition | undefined;

    const maxIterations = options.maxIterations ?? this.maxIterations;

    for (let attempt = 1; attempt <= maxIterations; attempt += 1) {
      const messages = this.buildMessages(request.conversationHistory, systemPrompt, userMessage, lastErrors);
      const response = await this.callLLM(messages);
      this.agentLogger.logLLMCall({
        sessionId,
        phase: 'generating',
        systemPrompt,
        userMessage,
        response,
      });

      reasoning = this.extractReasoning(response);
      try {
        workflow = this.extractWorkflow(response);
        workflow = this.normalizeWorkflow(workflow);
      } catch (error) {
        const repaired = await this.repairWorkflowJson(response, sessionId);
        if (repaired) {
          workflow = repaired;
        } else {
          lastErrors = [
            error instanceof Error ? error.message : 'LLM未返回有效的工作流JSON',
          ];
          continue;
        }
      }

      this.agentLogger.logWorkflowGenerated({
        sessionId,
        attempt,
        workflow,
        reasoning,
      });

      const validation = await this.mcpClient.validateWorkflow(workflow);
      this.agentLogger.logValidationResult({
        sessionId,
        attempt,
        stage: 'initial',
        validationResult: this.summarizeValidation(validation),
      });
      if (validation.isValid) {
        const result: WorkflowResult = {
          success: true,
          workflow,
          validationResult: { isValid: true, errors: [] },
          iterations: attempt,
          reasoning,
        };
        this.cache.set(cacheKey, result, this.cacheTtlSeconds);
        return result;
      }

      const fixed = await this.mcpClient.autofixWorkflow(workflow);
      const fixedValidation = await this.mcpClient.validateWorkflow(fixed);
      this.agentLogger.logValidationResult({
        sessionId,
        attempt,
        stage: 'autofix',
        validationResult: this.summarizeValidation(fixedValidation),
      });
      if (fixedValidation.isValid) {
        const result: WorkflowResult = {
          success: true,
          workflow: fixed,
          validationResult: { isValid: true, errors: [] },
          iterations: attempt,
          reasoning,
        };
        this.cache.set(cacheKey, result, this.cacheTtlSeconds);
        return result;
      }

      lastErrors = fixedValidation.errors.map((error) => error.message);
      logger.debug('WorkflowArchitect: validation failed', { attempt, errors: lastErrors });
    }

    return {
      success: false,
      workflow,
      validationResult: { isValid: false, errors: lastErrors.map((message) => ({ message })) },
      iterations: maxIterations,
      reasoning,
    };
  }

  private buildMessages(
    history: ConversationTurn[],
    systemPrompt: string,
    userMessage: string,
    errors: string[]
  ): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    history.forEach((turn) => {
      messages.push({ role: turn.role, content: turn.content });
    });

    if (errors.length > 0) {
      messages.push({
        role: 'assistant',
        content: `上一次验证失败，错误如下：${errors.join('；')}。请修正后重新输出。`,
      });
    }

    messages.push({ role: 'user', content: userMessage });
    return messages;
  }

  private buildUserMessage(request: WorkflowRequest): string {
    const entityStr = Object.entries(request.entities)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    return `
请为以下需求生成一个n8n工作流：

用户意图: ${request.userIntent}
识别实体: ${entityStr || '无'}

要求：
1. 使用search_nodes查询需要的节点类型
2. 使用get_node确认节点配置与typeVersion
3. 输出完整workflow JSON（包含nodes/connections/settings）
4. 仅使用允许的节点类型：${ALLOWED_NODE_TYPES.join(', ')}
5. 先输出Reasoning，再输出JSON代码块
`;
  }

  private async buildNodeContext(components: HardwareComponent[]): Promise<string> {
    const key = components.map((component) => component.name).sort().join('|');
    const cacheKey = `node-context:${key || 'all'}`;
    const cached = this.nodeContextCache.get(cacheKey);
    if (cached) {
      return cached as string;
    }

    const nodeTypes = new Set<string>(BASE_NODE_TYPES);
    components.forEach((component) => {
      if (ALLOWED_NODE_TYPES.includes(component.nodeType)) {
        nodeTypes.add(component.nodeType);
      }
    });

    for (const query of BASE_NODE_QUERIES) {
      await this.mcpClient.searchNodes({ query, limit: 5, includeExamples: false });
    }

    const details = await Promise.all(
      Array.from(nodeTypes).map(async (nodeType) => {
        try {
          return await this.mcpClient.getNode({ nodeType, detail: 'standard' });
        } catch {
          return null;
        }
      })
    );

    const context = details
      .filter(Boolean)
      .map((node) =>
        JSON.stringify(
          {
            nodeType: node!.nodeType,
            displayName: node!.displayName,
            defaultVersion: node!.defaultVersion,
            properties: node!.properties,
          },
          null,
          2
        )
      )
      .join('\n');

    this.nodeContextCache.set(cacheKey, context, this.cacheTtlSeconds);
    return context;
  }

  private async callLLM(messages: ChatMessage[]): Promise<string> {
    const timeout = new Promise<string>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error('LLM request timed out'));
      }, this.llmTimeoutMs);
    });

    return Promise.race([this.llmClient.chat(messages), timeout]) as Promise<string>;
  }

  private extractReasoning(response: string): string {
    const match = response.match(/Reasoning:\s*([\s\S]*?)(\n```json|\n\{)/i);
    if (match) {
      return match[1].trim();
    }
    return '';
  }

  private extractWorkflow(response: string): WorkflowDefinition {
    const candidates: string[] = [];
    const jsonBlock = response.match(/```json\n([\s\S]*?)\n```/);
    if (jsonBlock?.[1]) {
      candidates.push(jsonBlock[1]);
    }
    const braceStart = response.indexOf('{');
    if (braceStart >= 0) {
      const braceEnd = response.lastIndexOf('}');
      if (braceEnd > braceStart) {
        candidates.push(response.slice(braceStart, braceEnd + 1));
      } else {
        candidates.push(response.slice(braceStart));
      }
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const parsed = this.parseWorkflow(candidate);
        if (!parsed?.name || !parsed?.nodes || !parsed?.connections) {
          throw new Error('工作流JSON缺少name/nodes/connections');
        }
        return parsed;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '无法解析工作流JSON');
      }
    }

    throw new Error(errors[0] ?? 'LLM未返回有效的工作流JSON');
  }

  private parseWorkflow(rawJson: string): WorkflowDefinition {
    const trimmed = rawJson.trim();
    try {
      return JSON.parse(trimmed) as WorkflowDefinition;
    } catch (error) {
      const repaired = this.repairJson(trimmed);
      if (repaired && repaired !== trimmed) {
        return JSON.parse(repaired) as WorkflowDefinition;
      }
      throw error;
    }
  }

  private repairJson(rawJson: string): string | null {
    if (!rawJson.startsWith('{')) {
      return null;
    }
    const openCurly = (rawJson.match(/{/g) ?? []).length;
    const closeCurly = (rawJson.match(/}/g) ?? []).length;
    const openSquare = (rawJson.match(/\[/g) ?? []).length;
    const closeSquare = (rawJson.match(/]/g) ?? []).length;

    let repaired = rawJson;
    if (openSquare > closeSquare) {
      repaired += ']'.repeat(openSquare - closeSquare);
    }
    if (openCurly > closeCurly) {
      repaired += '}'.repeat(openCurly - closeCurly);
    }
    return repaired;
  }

  private async repairWorkflowJson(
    response: string,
    sessionId: string
  ): Promise<WorkflowDefinition | null> {
    const repairSystemPrompt = `
你是一个JSON修复工具。请将输入中的工作流JSON修复为严格有效的JSON。
要求：
1. 只输出JSON本体，不要解释、不要markdown代码块。
2. 保留原意，不要添加新字段。
3. 确保JSON可以被JSON.parse解析。
`.trim();
    const repairUserMessage = `修复以下JSON并仅输出修复后的JSON：\n${response}`;
    const repairResponse = await this.callLLM([
      { role: 'system', content: repairSystemPrompt },
      { role: 'user', content: repairUserMessage },
    ]);
    this.agentLogger.logLLMCall({
      sessionId,
      phase: 'generating',
      systemPrompt: repairSystemPrompt,
      userMessage: repairUserMessage,
      response: repairResponse,
    });

    try {
      const repaired = this.extractWorkflow(repairResponse);
      return this.normalizeWorkflow(repaired);
    } catch (error) {
      logger.warn('WorkflowArchitect: JSON repair failed', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
      return null;
    }
  }

  private normalizeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
    if (!Array.isArray(workflow.nodes)) {
      return workflow;
    }
    this.ensureNodeIds(workflow.nodes);
    workflow.nodes.forEach((node) => {
      if (node?.type !== 'n8n-nodes-base.if') {
        return;
      }
      const params = (node?.parameters ?? {}) as Record<string, any>;
      if (!params.conditions) {
        return;
      }
      if (params.conditions.combinator && Array.isArray(params.conditions.conditions)) {
        if (params.combineOperation) {
          delete params.combineOperation;
        }
        return;
      }
      const normalized = this.convertLegacyIfConditions(params.conditions, params.combineOperation);
      if (normalized.conditions.length > 0) {
        params.conditions = normalized;
        delete params.combineOperation;
      }
    });
    return workflow;
  }

  private ensureNodeIds(nodes: Array<Record<string, any>>): void {
    const seen = new Set<string>();
    nodes.forEach((node) => {
      if (!node || typeof node !== 'object') {
        return;
      }
      let id = typeof node.id === 'string' ? node.id : '';
      if (!id || seen.has(id)) {
        id = randomUUID();
        node.id = id;
      }
      seen.add(id);
    });
  }

  private convertLegacyIfConditions(conditions: any, combineOperation?: string): {
    combinator: 'and' | 'or';
    conditions: Array<{
      id: string;
      leftValue: unknown;
      rightValue: unknown;
      operator: { type: string; operation: string };
    }>;
  } {
    const combinator: 'and' | 'or' = combineOperation === 'any' ? 'or' : 'and';
    const normalizedConditions: Array<{
      id: string;
      leftValue: unknown;
      rightValue: unknown;
      operator: { type: string; operation: string };
    }> = [];

    if (!conditions || typeof conditions !== 'object') {
      return { combinator, conditions: normalizedConditions };
    }

    Object.entries(conditions).forEach(([type, entries]) => {
      if (!Array.isArray(entries)) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry) {
          return;
        }
        normalizedConditions.push({
          id: entry.id ?? randomUUID(),
          leftValue: entry.value1 ?? entry.leftValue,
          rightValue: entry.value2 ?? entry.rightValue ?? '',
          operator: {
            type,
            operation: this.mapLegacyOperation(entry.operation),
          },
        });
      });
    });

    return { combinator, conditions: normalizedConditions };
  }

  private mapLegacyOperation(operation: string | undefined): string {
    if (!operation) {
      return 'equals';
    }
    const mapping: Record<string, string> = {
      equal: 'equals',
      notEqual: 'notEquals',
      contains: 'contains',
      notContains: 'notContains',
      startsWith: 'startsWith',
      endsWith: 'endsWith',
      regex: 'regex',
      notRegex: 'notRegex',
      exists: 'exists',
      notExists: 'notExists',
      empty: 'empty',
      notEmpty: 'notEmpty',
      isEmpty: 'empty',
      isNotEmpty: 'notEmpty',
      larger: 'gt',
      largerEqual: 'gte',
      smaller: 'lt',
      smallerEqual: 'lte',
      isTrue: 'true',
      isFalse: 'false',
    };
    return mapping[operation] ?? operation;
  }

  private summarizeValidation(validation: ValidationResult): ValidationSummary {
    return {
      isValid: validation.isValid,
      errors: validation.errors.map((error) => ({
        message: error.message,
        code: error.code,
        nodeName: error.nodeName,
        nodeId: error.nodeId,
      })),
      warnings: validation.warnings.map((warning) => ({
        message: warning.message,
        code: warning.code,
        nodeName: warning.nodeName,
        nodeId: warning.nodeId,
      })),
    };
  }

}
