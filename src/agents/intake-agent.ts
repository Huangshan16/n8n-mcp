import { AgentConfig } from './agent-config';
import { LLMClient } from './llm-client';
import { WorkflowArchitect } from './workflow-architect';
import { HardwareService } from './hardware-service';
import { SessionService } from './session-service';
import { AgentResponse, ConversationTurn, Intent } from './types';
import { HardwareComponent } from './hardware-components';
import { logger } from '../utils/logger';

export class IntakeAgent {
  constructor(
    private config: AgentConfig,
    private llmClient: LLMClient,
    private workflowArchitect: WorkflowArchitect,
    private hardwareService: HardwareService,
    private sessionService: SessionService,
    private hardwareComponents: HardwareComponent[]
  ) {}

  async processUserInput(userMessage: string, sessionId: string): Promise<AgentResponse> {
    logger.debug('IntakeAgent: processing message', { sessionId, messageLength: userMessage.length });
    this.sessionService.appendTurn(sessionId, 'user', userMessage);
    const history = this.sessionService.getHistory(sessionId);

    const intent = await this.extractIntent(userMessage, history);
    const missingInfo = this.checkMissingInfo(intent);
    logger.debug('IntakeAgent: intent summary', {
      sessionId,
      intent,
      missingInfo,
    });

    if (missingInfo.length > 0) {
      const question = await this.generateGuidanceQuestion(intent, missingInfo);
      const response: AgentResponse = {
        type: 'guidance',
        message: question,
      };
      this.sessionService.appendTurn(sessionId, 'assistant', response.message);
      return response;
    }

    if (intent.confidence < this.config.convergenceThreshold) {
      const response: AgentResponse = {
        type: 'guidance',
        message: '我需要再确认一下，你希望机器人具体执行什么动作？',
      };
      this.sessionService.appendTurn(sessionId, 'assistant', response.message);
      return response;
    }

    try {
      const components = this.resolveHardwareComponents(intent);
      const result = await this.workflowArchitect.generateWorkflow({
        userIntent: userMessage,
        entities: intent.entities,
        hardwareComponents: components,
        conversationHistory: history,
      });

      if (!result.success || !result.workflow) {
        return {
          type: 'error',
          message: `工作流生成失败：${result.validationResult?.errors[0]?.message || '未知错误'}`,
          details: result.validationResult,
        };
      }

      this.sessionService.setWorkflow(sessionId, result.workflow);

      const response: AgentResponse = {
        type: 'workflow_ready',
        message: `已为您生成工作流「${result.workflow.name}」。`,
        workflow: result.workflow,
        reasoning: result.reasoning,
        metadata: {
          iterations: result.iterations,
          nodeCount: result.workflow.nodes.length,
        },
      };

      this.sessionService.appendTurn(sessionId, 'assistant', response.message);
      return response;
    } catch (error) {
      logger.error('WorkflowArchitect error', error);
      return {
        type: 'error',
        message: '抱歉，工作流生成过程中出现错误，请稍后重试。',
      };
    }
  }

  private async extractIntent(message: string, history: ConversationTurn[]): Promise<Intent> {
    const hardwareLines = this.hardwareComponents
      .map((hw) => `- ${hw.displayName}: ${hw.capabilities.join(', ')}`)
      .join('\n');

    const systemPrompt = `
你是一个意图分析专家，专门理解用户对硬件机器人的需求。

任务：
1. 识别意图类型（face_recognition_action, emotion_interaction, game_interaction, custom）
2. 提取关键实体（person_name, gesture, speech_content, emotion_mode等）
3. 返回缺失信息列表（missingInfo）

可用硬件组件：
${hardwareLines}

请输出JSON：
{
  "category": "intent类型",
  "entities": { "key": "value" },
  "confidence": 0.95,
  "missingInfo": []
}
`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: systemPrompt },
        ...history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: message },
      ]);

      const json = this.extractJson(response);
      const parsed = JSON.parse(json) as Intent;
      return {
        category: parsed.category ?? 'custom',
        entities: parsed.entities ?? {},
        confidence: parsed.confidence ?? 0.7,
        missingInfo: parsed.missingInfo ?? [],
      };
    } catch (error) {
      logger.warn('IntakeAgent: extractIntent fallback', error);
      return this.fallbackIntent(message);
    }
  }

  private extractJson(response: string): string {
    const block = response.match(/```json\n([\s\S]*?)\n```/);
    if (block) {
      return block[1];
    }
    const braceIndex = response.indexOf('{');
    if (braceIndex >= 0) {
      return response.slice(braceIndex);
    }
    throw new Error('LLM intent response missing JSON');
  }

  private fallbackIntent(message: string): Intent {
    const lower = message.toLowerCase();
    const entities: Record<string, string> = {};

    if (message.includes('石头剪刀布')) {
      entities.game_type = 'rps';
      return { category: 'game_interaction', entities, confidence: 0.75 };
    }

    if (message.includes('情感') || message.includes('共情')) {
      entities.emotion_mode = 'support';
      return { category: 'emotion_interaction', entities, confidence: 0.7 };
    }

    if (message.includes('识别') || message.includes('人脸') || message.includes('见到')) {
      const personMatch = message.match(/(?:见到|识别)([^，。！？,!.?\s]{1,4})/);
      if (personMatch?.[1]) {
        entities.person_name = personMatch[1];
      }
      return { category: 'face_recognition_action', entities, confidence: 0.7 };
    }

    if (lower.includes('hello') || message.includes('你好')) {
      return { category: 'custom', entities, confidence: 0.5 };
    }

    return { category: 'custom', entities, confidence: 0.6 };
  }

  private checkMissingInfo(intent: Intent): string[] {
    if (intent.missingInfo && intent.missingInfo.length > 0) {
      return intent.missingInfo;
    }

    const required: Record<string, string[]> = {
      face_recognition_action: ['person_name', 'gesture', 'speech_content'],
      emotion_interaction: ['emotion_mode'],
      game_interaction: ['game_type'],
    };

    const missing: string[] = [];
    const requiredFields = required[intent.category] || [];
    requiredFields.forEach((field) => {
      if (!intent.entities[field]) {
        missing.push(field);
      }
    });

    return missing;
  }

  private async generateGuidanceQuestion(intent: Intent, missingInfo: string[]): Promise<string> {
    const readable = missingInfo.map((field) => this.humanizeField(field)).join('、');
    const prompt = `
你是一个机器人助手，请根据用户意图提出补充问题。
意图类型: ${intent.category}
缺失信息: ${readable}
请输出一句简短友好的中文问题，不超过30字。
`;

    try {
      const response = await this.llmClient.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: '请生成引导问题。' },
      ]);
      if (response.trim()) {
        return response.trim();
      }
    } catch {
      logger.warn('IntakeAgent: LLM guidance failed, using fallback');
    }

    return `还需要补充一下${readable}吗？`;
  }

  private humanizeField(field: string): string {
    const mapping: Record<string, string> = {
      person_name: '人物名称',
      gesture: '动作手势',
      speech_content: '语音内容',
      emotion_mode: '情绪模式',
      game_type: '游戏类型',
    };

    return mapping[field] || field;
  }

  private resolveHardwareComponents(intent: Intent): HardwareComponent[] {
    const inferred = this.hardwareService.inferComponentsFromIntent(intent);
    if (inferred.length === 0) {
      return this.hardwareComponents;
    }
    return this.hardwareComponents.filter((component) => inferred.includes(component.name));
  }
}
