import { AgentConfig } from './agent-config';
import { LLMClient } from './llm-client';
import { WorkflowArchitect } from './workflow-architect';
import { HardwareService } from './hardware-service';
import { SessionService } from './session-service';
import { AgentResponse, ConversationTurn, Intent, WorkflowBlueprint } from './types';
import { HardwareComponent } from './hardware-components';
import { logger } from '../utils/logger';

export class IntakeAgent {
  private static readonly SUMMARY_CADENCE = 3;
  private static readonly CONFIRM_MAX_ATTEMPTS = 3;

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
    const blueprint = this.buildBlueprint(userMessage, intent);
    this.sessionService.setIntent(sessionId, intent);
    this.sessionService.setBlueprint(sessionId, blueprint);
    this.sessionService.setConfirmed(sessionId, false);
    this.sessionService.clearWorkflow(sessionId);

    const missingInfo = blueprint.missingFields;
    logger.debug('IntakeAgent: intent summary', {
      sessionId,
      intent,
      missingInfo,
    });

    const shouldSummarize = this.sessionService.shouldSummarize(
      sessionId,
      IntakeAgent.SUMMARY_CADENCE
    );

    if (shouldSummarize || missingInfo.length === 0) {
      const response: AgentResponse = {
        type: 'summary_ready',
        message: this.renderBlueprintSummary(blueprint),
        blueprint,
      };
      this.sessionService.appendTurn(sessionId, 'assistant', response.message);
      this.sessionService.markSummary(sessionId);
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

    const question = await this.generateGuidanceQuestion(intent, missingInfo);
    const response: AgentResponse = {
      type: 'guidance',
      message: question,
    };
    this.sessionService.appendTurn(sessionId, 'assistant', response.message);
    return response;
  }

  async confirmBlueprint(sessionId: string): Promise<AgentResponse> {
    const session = this.sessionService.getSession(sessionId);
    if (!session) {
      return { type: 'error', message: 'Session not found. 请先发送需求。' };
    }

    const blueprint = session.blueprint;
    const intent = session.intent;
    if (!blueprint || !intent) {
      return { type: 'guidance', message: '请先描述需求，我才能生成工作流。' };
    }

    if (blueprint.missingFields.length > 0) {
      const question = await this.generateGuidanceQuestion(intent, blueprint.missingFields);
      const response: AgentResponse = { type: 'guidance', message: question };
      this.sessionService.appendTurn(sessionId, 'assistant', response.message);
      return response;
    }

    const hardwareComponents = this.resolveHardwareComponents(intent);
    const userIntent = this.renderBlueprintSummary(blueprint);
    const history = this.sessionService.getHistory(sessionId);
    let lastError = '工作流校验失败';

    for (let attempt = 1; attempt <= IntakeAgent.CONFIRM_MAX_ATTEMPTS; attempt += 1) {
      logger.debug('IntakeAgent: generating workflow after confirm', { sessionId, attempt });
      const result = await this.workflowArchitect.generateWorkflow(
        {
          userIntent,
          entities: intent.entities,
          hardwareComponents,
          conversationHistory: history,
        },
        { maxIterations: 1 }
      );

      if (result.success && result.workflow) {
        this.sessionService.setWorkflow(sessionId, result.workflow);
        this.sessionService.setConfirmed(sessionId, true);
        const response: AgentResponse = {
          type: 'workflow_ready',
          message: `工作流已生成，共${result.workflow.nodes.length}个节点，可继续创建。`,
          workflow: result.workflow,
          reasoning: result.reasoning,
          metadata: {
            iterations: result.iterations,
            nodeCount: result.workflow.nodes.length,
          },
        };
        this.sessionService.appendTurn(sessionId, 'assistant', response.message);
        return response;
      }

      if (result.validationResult?.errors?.length) {
        lastError = result.validationResult.errors.map((error) => error.message).join('；');
      }
    }

    const response: AgentResponse = {
      type: 'guidance',
      message: `工作流校验失败：${lastError}。请补充说明后再试。`,
    };
    this.sessionService.appendTurn(sessionId, 'assistant', response.message);
    return response;
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

  private buildBlueprint(message: string, intent: Intent): WorkflowBlueprint {
    const triggers: WorkflowBlueprint['triggers'] = [];
    const logic: WorkflowBlueprint['logic'] = [];
    const executors: WorkflowBlueprint['executors'] = [];
    const missingFields = new Set<string>(intent.missingInfo ?? []);

    const scheduleKeywords = ['定时', '每天', '每周', '每月', '每隔', '定期'];
    const hasSchedule = scheduleKeywords.some((keyword) => message.includes(keyword));
    if (hasSchedule) {
      triggers.push({ type: 'scheduleTrigger', config: {} });
      if (!message.match(/\d{1,2}[:点]\d{0,2}/)) {
        missingFields.add('schedule_time');
      }
    } else {
      triggers.push({ type: 'webhook', config: { path: 'camera-input' } });
    }

    const personMatches = Array.from(message.matchAll(/老[\u4e00-\u9fa5]{1,2}/g)).map((m) => m[0]);
    const uniquePeople = Array.from(new Set(personMatches));
    if (uniquePeople.length >= 1) {
      logic.push({ type: 'if', config: { persons: uniquePeople } });
    }
    if (message.includes('循环') || message.includes('批量')) {
      logic.push({ type: 'splitInBatches', config: {} });
    }

    executors.push({ type: 'set', config: {} });
    executors.push({ type: 'httpRequest', config: {} });

    const requiredByCategory: Record<string, string[]> = {
      face_recognition_action: ['person_name', 'gesture', 'speech_content', 'tts_voice'],
      emotion_interaction: ['emotion_mode'],
      game_interaction: ['game_type'],
    };

    const requiredFields = requiredByCategory[intent.category] || [];
    requiredFields.forEach((field) => {
      if (!intent.entities[field]) {
        missingFields.add(field);
      }
    });

    if (intent.category === 'face_recognition_action') {
      const gestureKeywords = ['竖中指', '比个V', '比V', '点赞', '挥手', '招手', '握手'];
      const hasGesture = gestureKeywords.some((keyword) => message.includes(keyword));
      if (!hasGesture) {
        missingFields.add('gesture');
      }

      const hasSpeech = /["“][^"”]+["”]/.test(message) || message.includes('说');
      if (!hasSpeech) {
        missingFields.add('speech_content');
      }

      if (message.includes('音色')) {
        const voiceMatch = message.match(/音色\s*([abc])/i);
        if (!voiceMatch) {
          missingFields.add('tts_voice');
        }
      } else {
        missingFields.add('tts_voice');
      }
    }

    return {
      intentSummary: message.trim(),
      triggers,
      logic,
      executors,
      missingFields: Array.from(missingFields),
    };
  }

  private renderBlueprintSummary(blueprint: WorkflowBlueprint): string {
    const parts: string[] = [];
    parts.push(`已整理当前逻辑：${blueprint.intentSummary}`);

    if (blueprint.triggers.length > 0) {
      parts.push(`触发器：${blueprint.triggers.map((t) => t.type).join(' / ')}`);
    }
    if (blueprint.logic.length > 0) {
      parts.push(`逻辑：${blueprint.logic.map((l) => l.type).join(' / ')}`);
    }
    if (blueprint.executors.length > 0) {
      parts.push(`执行：${blueprint.executors.map((e) => e.type).join(' / ')}`);
    }
    if (blueprint.missingFields.length > 0) {
      parts.push(`还缺：${blueprint.missingFields.map((field) => this.humanizeField(field)).join('、')}`);
    }

    return parts.join('\n');
  }
}
