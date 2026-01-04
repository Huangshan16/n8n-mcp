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
    const session = this.sessionService.getOrCreate(sessionId);
    if (session.phase !== 'understanding') {
      this.sessionService.setPhase(sessionId, 'understanding');
    }
    const history = this.sessionService.getHistory(sessionId);

    const intent = await this.extractIntent(userMessage, history);
    const inlineEntities = this.extractInlineEntities(userMessage);
    const confirmedEntities = this.sessionService.mergeConfirmedEntities(sessionId, {
      ...intent.entities,
      ...inlineEntities,
    });
    const effectiveIntent: Intent = {
      ...intent,
      entities: confirmedEntities,
    };
    const missingInfo = this.getMissingInfo(intent.category, confirmedEntities, userMessage);
    const blueprint = this.buildBlueprint(userMessage, intent.category, confirmedEntities, missingInfo);
    this.sessionService.setIntent(sessionId, effectiveIntent);
    this.sessionService.setBlueprint(sessionId, blueprint);
    this.sessionService.setWorkflowSummary(sessionId, undefined);
    this.sessionService.setConfirmed(sessionId, false);
    this.sessionService.clearWorkflow(sessionId);

    logger.debug('IntakeAgent: intent summary', {
      sessionId,
      category: intent.category,
      confirmedEntities,
      missingInfo,
    });

    const shouldSummarize = this.sessionService.shouldSummarize(
      sessionId,
      IntakeAgent.SUMMARY_CADENCE
    );

    if (shouldSummarize || missingInfo.length === 0) {
      const summary = this.generateSummary(confirmedEntities, blueprint, missingInfo);
      this.sessionService.setWorkflowSummary(sessionId, summary);
      const response: AgentResponse = {
        type: 'summary_ready',
        message: summary,
        blueprint,
        confirmedEntities,
        missingInfo,
        metadata: {
          showContinueButton: true,
          showConfirmBuildButton: missingInfo.length === 0,
        },
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

    const question = await this.generateGuidanceQuestion(intent.category, confirmedEntities, missingInfo);
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
    if (!intent) {
      return { type: 'guidance', message: '请先描述需求，我才能生成工作流。' };
    }

    const confirmedEntities = session.confirmedEntities;
    const missingInfo = this.getMissingInfo(intent.category, confirmedEntities, blueprint?.intentSummary ?? '');
    if (missingInfo.length > 0) {
      const question = await this.generateGuidanceQuestion(intent.category, confirmedEntities, missingInfo);
      const response: AgentResponse = { type: 'guidance', message: question };
      this.sessionService.appendTurn(sessionId, 'assistant', response.message);
      return response;
    }

    this.sessionService.setPhase(sessionId, 'generating');
    const effectiveIntent: Intent = { ...intent, entities: confirmedEntities };
    const hardwareComponents = this.resolveHardwareComponents(effectiveIntent);
    const lastUserMessage =
      session.history.slice().reverse().find((turn) => turn.role === 'user')?.content ?? '';
    const resolvedBlueprint =
      blueprint ?? this.buildBlueprint(lastUserMessage, intent.category, confirmedEntities, missingInfo);
    const summary =
      session.workflowSummary ?? this.generateSummary(confirmedEntities, resolvedBlueprint, missingInfo);
    this.sessionService.setWorkflowSummary(sessionId, summary);
    const history = this.sessionService.getHistory(sessionId);
    let lastError = '工作流校验失败';

    for (let attempt = 1; attempt <= IntakeAgent.CONFIRM_MAX_ATTEMPTS; attempt += 1) {
      logger.debug('IntakeAgent: generating workflow after confirm', { sessionId, attempt });
      const result = await this.workflowArchitect.generateWorkflow(
        {
          sessionId,
          userIntent: summary,
          entities: confirmedEntities,
          hardwareComponents,
          conversationHistory: history,
        },
        { maxIterations: 1 }
      );

      if (result.success && result.workflow) {
        this.sessionService.setWorkflow(sessionId, result.workflow);
        this.sessionService.setConfirmed(sessionId, true);
        this.sessionService.setPhase(sessionId, 'deploying');
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
        const missingFields = this.extractMissingFieldsFromError(lastError);
        if (missingFields.length > 0 && attempt < IntakeAgent.CONFIRM_MAX_ATTEMPTS) {
          this.sessionService.setPhase(sessionId, 'understanding');
          const response: AgentResponse = {
            type: 'guidance',
            message: `工作流生成遇到问题，还需要确认：${missingFields.map((field) => this.humanizeField(field)).join('、')}`,
          };
          this.sessionService.appendTurn(sessionId, 'assistant', response.message);
          return response;
        }
      }
    }

    const response: AgentResponse = {
      type: 'guidance',
      message: `工作流校验失败：${lastError}。请补充说明后再试。`,
    };
    this.sessionService.setPhase(sessionId, 'understanding');
    this.sessionService.appendTurn(sessionId, 'assistant', response.message);
    return response;
  }

  private async extractIntent(message: string, history: ConversationTurn[]): Promise<Intent> {
    const hardwareLines = this.hardwareComponents
      .map((hw) => `- ${hw.displayName}: ${hw.capabilities.join(', ')}`)
      .join('\n');

    const systemPrompt = `
你是一个工作流配置分析专家，专门提取用户需求中的节点配置信息。

# 可用硬件组件
${hardwareLines}

# 你的任务
从用户输入中提取以下信息：
1. 人物识别: person_name (例如：老刘、老付)
2. 手势动作: gesture (中指、V手势、大拇指、挥手)
3. 语音内容: speech_content (具体说的话)
4. 音色选择: tts_voice (a、b、c)
5. 情绪模式: emotion_mode
6. 游戏类型: game_type

# 禁止输出无关信息
- 不要追加情绪、心情、语言偏好等字段
- 不要加入用户没有明确提到的配置

请输出JSON：
{
  "category": "intent类型",
  "entities": { "key": "value" },
  "confidence": 0.95
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
    const inlineEntities = this.extractInlineEntities(message);

    if (message.includes('石头剪刀布')) {
      entities.game_type = 'rps';
      return { category: 'game_interaction', entities: { ...entities, ...inlineEntities }, confidence: 0.75 };
    }

    if (message.includes('情感') || message.includes('共情')) {
      entities.emotion_mode = 'support';
      return { category: 'emotion_interaction', entities: { ...entities, ...inlineEntities }, confidence: 0.7 };
    }

    if (message.includes('识别') || message.includes('人脸') || message.includes('见到')) {
      const personMatch = message.match(/(?:见到|识别)([^，。！？,!.?\s]{1,4})/);
      if (personMatch?.[1]) {
        entities.person_name = personMatch[1];
      }
      return { category: 'face_recognition_action', entities: { ...entities, ...inlineEntities }, confidence: 0.7 };
    }

    if (lower.includes('hello') || message.includes('你好')) {
      return { category: 'custom', entities: { ...entities, ...inlineEntities }, confidence: 0.5 };
    }

    return { category: 'custom', entities: { ...entities, ...inlineEntities }, confidence: 0.6 };
  }

  private async generateGuidanceQuestion(
    category: Intent['category'],
    confirmedEntities: Record<string, string>,
    missingInfo: string[]
  ): Promise<string> {
    const readable = missingInfo.map((field) => this.humanizeField(field)).join('、');
    const confirmedText = Object.entries(confirmedEntities)
      .map(([key, value]) => `${this.humanizeField(key)}: ${value}`)
      .join('；');
    const prompt = `
你是一个机器人助手，只能询问工作流节点配置相关的信息。
意图类型: ${category}
已确认: ${confirmedText || '暂无'}
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
      tts_voice: '音色',
      emotion_mode: '情绪模式',
      game_type: '游戏类型',
      schedule_time: '触发时间',
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

  private buildBlueprint(
    message: string,
    category: Intent['category'],
    confirmedEntities: Record<string, string>,
    missingInfo: string[]
  ): WorkflowBlueprint {
    const triggers: WorkflowBlueprint['triggers'] = [];
    const logic: WorkflowBlueprint['logic'] = [];
    const executors: WorkflowBlueprint['executors'] = [];
    const missingFields = new Set<string>(missingInfo);

    const scheduleKeywords = ['定时', '每天', '每周', '每月', '每隔', '定期'];
    const hasSchedule = Boolean(confirmedEntities.schedule_time) || scheduleKeywords.some((keyword) => message.includes(keyword));
    if (hasSchedule) {
      triggers.push({ type: 'scheduleTrigger', config: {} });
      if (!confirmedEntities.schedule_time && !message.match(/\d{1,2}[:点]\d{0,2}/)) {
        missingFields.add('schedule_time');
      }
    } else {
      triggers.push({ type: 'webhook', config: { path: 'camera-input' } });
    }

    const personMatches = Array.from(message.matchAll(/老[\u4e00-\u9fa5]{1,2}/g)).map((m) => m[0]);
    const confirmedPeople = confirmedEntities.person_name
      ? confirmedEntities.person_name
          .split(/[，,]/)
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    const uniquePeople = Array.from(new Set([...confirmedPeople, ...personMatches]));
    if (uniquePeople.length >= 1) {
      logic.push({ type: 'if', config: { persons: uniquePeople } });
    }
    if (message.includes('循环') || message.includes('批量')) {
      logic.push({ type: 'splitInBatches', config: {} });
    }

    executors.push({ type: 'set', config: {} });
    executors.push({ type: 'httpRequest', config: {} });

    return {
      intentSummary: message.trim(),
      triggers,
      logic,
      executors,
      missingFields: Array.from(missingFields),
    };
  }

  private getMissingInfo(
    category: Intent['category'],
    confirmedEntities: Record<string, string>,
    message: string
  ): string[] {
    const missingFields = new Set<string>();
    const requiredByCategory: Record<string, string[]> = {
      face_recognition_action: ['person_name', 'gesture', 'speech_content', 'tts_voice'],
      emotion_interaction: ['emotion_mode'],
      game_interaction: ['game_type'],
    };

    const requiredFields = requiredByCategory[category] || [];
    requiredFields.forEach((field) => {
      if (!confirmedEntities[field]) {
        missingFields.add(field);
      }
    });

    const scheduleKeywords = ['定时', '每天', '每周', '每月', '每隔', '定期'];
    const hasSchedule = scheduleKeywords.some((keyword) => message.includes(keyword));
    if (hasSchedule && !confirmedEntities.schedule_time) {
      missingFields.add('schedule_time');
    }

    return Array.from(missingFields);
  }

  private extractInlineEntities(message: string): Record<string, string> {
    const entities: Record<string, string> = {};

    const voiceMatch = message.match(/音色\s*([abc])/i);
    if (voiceMatch?.[1]) {
      entities.tts_voice = voiceMatch[1].toLowerCase();
    }

    const gestureKeywords = ['竖中指', '比个V', '比V', '点赞', '挥手', '招手', '握手'];
    const gesture = gestureKeywords.find((keyword) => message.includes(keyword));
    if (gesture) {
      entities.gesture = gesture;
    }

    const speechMatch = message.match(/["“]([^"”]{1,20})["”]/);
    if (speechMatch?.[1]) {
      entities.speech_content = speechMatch[1];
    }

    const personMatch = message.match(/老[\u4e00-\u9fa5]{1,2}/);
    if (personMatch?.[0]) {
      entities.person_name = personMatch[0];
    }

    const scheduleMatch = message.match(/(\d{1,2})[:点]\d{0,2}/);
    if (scheduleMatch?.[0]) {
      entities.schedule_time = scheduleMatch[0];
    }

    return entities;
  }

  private generateSummary(
    confirmedEntities: Record<string, string>,
    blueprint: WorkflowBlueprint,
    missingInfo: string[]
  ): string {
    const confirmedLines = Object.entries(confirmedEntities)
      .map(([key, value]) => `- ${this.humanizeField(key)}: ${value}`)
      .join('\n');
    const missingLine = missingInfo.length > 0 ? `\n\n还缺少：${missingInfo.map((field) => this.humanizeField(field)).join('、')}` : '';
    return `
已整理当前逻辑配置：

已确认信息：
${confirmedLines || '- 暂无'}

触发器：${blueprint.triggers.map((t) => t.type).join(' / ') || '未指定'}
逻辑：${blueprint.logic.map((l) => l.type).join(' / ') || '未指定'}
执行：${blueprint.executors.map((e) => e.type).join(' / ') || '未指定'}${missingLine}
`.trim();
  }

  private extractMissingFieldsFromError(errorMessage: string): string[] {
    const matches = errorMessage.match(/Missing required field: ([\w_]+)/g);
    if (!matches) {
      return [];
    }
    return matches.map((match) => match.replace('Missing required field: ', ''));
  }
}
