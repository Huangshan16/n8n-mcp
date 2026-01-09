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
        const candidate = this.extractJsonCandidate(response);
        logger.warn('WorkflowArchitect: workflow JSON parse failed', {
          error: error instanceof Error ? error.message : 'LLM未返回有效的工作流JSON',
          jsonSnippet: this.truncateForLog(candidate ?? response, 2000),
        });
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
6. connections 必须用节点 name（不要用 id）
7. JSON 必须严格合法（双引号，无注释，无尾逗号）
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
    const candidates = this.extractJsonCandidates(response);
    if (candidates.length === 0) {
      candidates.push(response);
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const parsed = this.parseWorkflow(candidate);
        if (!parsed?.nodes) {
          throw new Error('工作流JSON缺少nodes');
        }
        if (!parsed.name) {
          parsed.name = 'Generated Workflow';
        }
        if (!parsed.connections || typeof parsed.connections !== 'object') {
          parsed.connections = {};
          this.addDefaultConnections(parsed);
        }
        return parsed;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : '无法解析工作流JSON');
      }
    }

    throw new Error(errors[0] ?? 'LLM未返回有效的工作流JSON');
  }

  private extractJsonCandidates(response: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null = null;
    while ((match = fencePattern.exec(response)) !== null) {
      const candidate = match[1]?.trim();
      if (!candidate) {
        continue;
      }
      const extracted = candidate.startsWith('{')
        ? candidate
        : this.extractBalancedJson(candidate) ?? candidate;
      if (!seen.has(extracted)) {
        seen.add(extracted);
        candidates.push(extracted);
      }
    }

    const balanced = this.extractBalancedJson(response);
    if (balanced && !seen.has(balanced)) {
      seen.add(balanced);
      candidates.push(balanced);
    }
    return candidates;
  }

  private extractJsonCandidate(response: string): string | null {
    return this.extractJsonCandidates(response)[0] ?? null;
  }

  private extractBalancedJson(response: string): string | null {
    let inString = false;
    let escape = false;
    let depth = 0;
    let start = -1;

    for (let index = 0; index < response.length; index += 1) {
      const char = response[index];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        if (depth === 0) {
          start = index;
        }
        depth += 1;
        continue;
      }

      if (char === '}') {
        if (depth > 0) {
          depth -= 1;
          if (depth === 0 && start >= 0) {
            return response.slice(start, index + 1);
          }
        }
      }
    }

    if (start >= 0) {
      return response.slice(start);
    }
    return null;
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
    const candidate = this.extractJsonCandidate(response);
    const repairUserMessage = `修复以下JSON并仅输出修复后的JSON：\n${candidate ?? response}`;
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
        jsonSnippet: this.truncateForLog(candidate ?? response, 2000),
      });
      return null;
    }
  }

  private truncateForLog(value: string, maxLength: number): string {
    if (!value) {
      return '';
    }
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
  }

  private normalizeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
    if (!Array.isArray(workflow.nodes)) {
      return workflow;
    }
    this.ensureNodeIds(workflow.nodes);
    if (!workflow.connections || typeof workflow.connections !== 'object') {
      workflow.connections = {};
      this.addDefaultConnections(workflow);
    }
    this.normalizeConnections(workflow);
    workflow.nodes.forEach((node) => {
      this.normalizeNode(node);
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

  private normalizeNode(node: Record<string, any> | undefined): void {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (!node.parameters || typeof node.parameters !== 'object') {
      node.parameters = {};
    }
    this.ensureDefaultTypeVersion(node);

    switch (node.type) {
      case 'n8n-nodes-base.webhook':
        this.normalizeWebhookNode(node);
        break;
      case 'n8n-nodes-base.if':
        this.normalizeIfNode(node);
        break;
      case 'n8n-nodes-base.set':
        this.normalizeSetNode(node);
        break;
      case 'n8n-nodes-base.httpRequest':
        this.normalizeHttpRequestNode(node);
        break;
      case 'n8n-nodes-base.scheduleTrigger':
        this.normalizeScheduleTriggerNode(node);
        break;
      case 'n8n-nodes-base.splitInBatches':
        this.normalizeSplitInBatchesNode(node);
        break;
      default:
        break;
    }
  }

  private ensureDefaultTypeVersion(node: Record<string, any>): void {
    const defaults: Record<string, number> = {
      'n8n-nodes-base.webhook': 2,
      'n8n-nodes-base.scheduleTrigger': 1.1,
      'n8n-nodes-base.if': 2.2,
      'n8n-nodes-base.splitInBatches': 3,
      'n8n-nodes-base.set': 3.4,
      'n8n-nodes-base.httpRequest': 4.3,
    };
    if (typeof node.typeVersion !== 'number' && typeof defaults[node.type] === 'number') {
      node.typeVersion = defaults[node.type];
    }
  }

  private normalizeWebhookNode(node: Record<string, any>): void {
    const params = node.parameters as Record<string, any>;
    if (!params.httpMethod) {
      params.httpMethod = 'POST';
    }
    if (!params.path) {
      params.path = 'webhook';
    }
    if (!params.responseMode) {
      params.responseMode = 'onReceived';
    }
    if (!params.options) {
      params.options = {};
    }
    if (params.responseMode === 'responseNode' && node.onError !== 'continueRegularOutput') {
      node.onError = 'continueRegularOutput';
    }
  }

  private normalizeIfNode(node: Record<string, any>): void {
    const params = node.parameters as Record<string, any>;
    if (!params.conditions) {
      return;
    }
    if (!params.conditions.combinator) {
      params.conditions.combinator = 'and';
    }
    if (!params.conditions.options) {
      params.conditions.options = {
        version: 2,
        caseSensitive: true,
        typeValidation: 'loose',
        leftValue: '',
      };
    }
  }

  private normalizeSetNode(node: Record<string, any>): void {
    const params = node.parameters as Record<string, any>;
    if (!params.assignments && params.values) {
      params.assignments = { assignments: this.convertSetValues(params.values) };
      delete params.values;
    }
    if (!params.assignments) {
      params.assignments = { assignments: [] };
    }
    if (!params.options) {
      params.options = {};
    }
    if (typeof params.includeOtherFields !== 'boolean') {
      params.includeOtherFields = false;
    }
  }

  private convertSetValues(values: Record<string, any>): Array<Record<string, unknown>> {
    const assignments: Array<Record<string, unknown>> = [];
    Object.entries(values).forEach(([type, entries]) => {
      if (!Array.isArray(entries)) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        assignments.push({
          id: entry.id ?? randomUUID(),
          name: entry.name ?? entry.field ?? '',
          type,
          value: entry.value ?? '',
        });
      });
    });
    return assignments;
  }

  private normalizeHttpRequestNode(node: Record<string, any>): void {
    const params = node.parameters as Record<string, any>;
    if (!params.options) {
      params.options = {};
    }
    if (typeof node.onError !== 'string') {
      node.onError = 'continueErrorOutput';
    }
  }

  private normalizeScheduleTriggerNode(node: Record<string, any>): void {
    const params = node.parameters as Record<string, any>;
    if (!params.rule) {
      params.rule = { interval: [{ field: 'minutes', minutesInterval: 5 }] };
    }
  }

  private normalizeSplitInBatchesNode(node: Record<string, any>): void {
    const params = node.parameters as Record<string, any>;
    if (!params.batchSize) {
      params.batchSize = 1;
    }
    if (!params.options) {
      params.options = { reset: false };
    }
  }

  private normalizeConnections(workflow: WorkflowDefinition): void {
    if (!workflow.connections || typeof workflow.connections !== 'object') {
      return;
    }
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const idToName = new Map<string, string>();
    nodes.forEach((node) => {
      if (typeof node?.id === 'string' && typeof node?.name === 'string') {
        idToName.set(node.id, node.name);
      }
    });

    const normalized: Record<string, unknown> = {};
    Object.entries(workflow.connections).forEach(([source, mapping]) => {
      const sourceName = idToName.get(source) ?? source;
      normalized[sourceName] = this.normalizeConnectionMapping(mapping, idToName);
    });
    workflow.connections = normalized as WorkflowDefinition['connections'];
  }

  private addDefaultConnections(workflow: WorkflowDefinition): void {
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    if (nodes.length < 2) {
      return;
    }

    const connections: Record<string, any> = workflow.connections ?? {};
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const source = nodes[index];
      const target = nodes[index + 1];
      const sourceName = typeof source?.name === 'string' ? source.name : null;
      const targetName = typeof target?.name === 'string' ? target.name : null;
      if (!sourceName || !targetName) {
        continue;
      }

      const entry = (connections[sourceName] ?? {}) as { main?: Array<any> };
      if (source.type === 'n8n-nodes-base.if') {
        const trueBranch = Array.isArray(entry.main?.[0]) ? entry.main![0] : [];
        trueBranch.push({ node: targetName, type: 'main', index: 0 });
        const falseBranch = Array.isArray(entry.main?.[1]) ? entry.main![1] : [];
        entry.main = [trueBranch, falseBranch];
      } else {
        const main = Array.isArray(entry.main?.[0]) ? entry.main![0] : [];
        main.push({ node: targetName, type: 'main', index: 0 });
        entry.main = [main];
      }

      connections[sourceName] = entry;
    }

    workflow.connections = connections as WorkflowDefinition['connections'];
  }

  private normalizeConnectionMapping(mapping: unknown, idToName: Map<string, string>): unknown {
    if (!mapping || typeof mapping !== 'object') {
      return mapping;
    }
    const result: Record<string, unknown> = {};
    Object.entries(mapping as Record<string, unknown>).forEach(([key, groups]) => {
      if (!Array.isArray(groups)) {
        result[key] = groups;
        return;
      }
      result[key] = groups.map((group) => {
        if (!Array.isArray(group)) {
          return group;
        }
        return group.map((connection) => {
          if (!connection || typeof connection !== 'object') {
            return connection;
          }
          const nodeRef = (connection as { node?: string }).node;
          const nodeName = nodeRef ? idToName.get(nodeRef) ?? nodeRef : nodeRef;
          return { ...(connection as Record<string, unknown>), node: nodeName };
        });
      });
    });
    return result;
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
