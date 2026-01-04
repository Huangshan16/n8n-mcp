import { AgentConfig } from './agent-config';
import { LLMClient } from './llm-client';
import { WorkflowArchitect } from './workflow-architect';
import { HardwareService } from './hardware-service';
import { SessionService } from './session-service';
import { AgentResponse, ConversationTurn, Intent, WorkflowBlueprint } from './types';
import { HardwareComponent } from './hardware-components';
import { AgentLogger } from './agent-logger';
import { logger } from '../utils/logger';

export class IntakeAgent {
  private static readonly SUMMARY_CADENCE = 3;
  private static readonly CONFIRM_MAX_ATTEMPTS = 3;
  private static readonly CONFIRM_WORKFLOW_ITERATIONS = 2;
  private agentLogger = new AgentLogger();

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
    const session = this.sessionService.appendTurn(sessionId, 'user', userMessage);
    this.agentLogger.logUserInput({
      sessionId: session.id,
      phase: session.phase,
      turnCount: session.userTurns,
      message: userMessage,
    });
    if (session.phase !== 'understanding') {
      this.agentLogger.logPhaseChange({
        sessionId: session.id,
        from: session.phase,
        to: 'understanding',
      });
      this.sessionService.setPhase(sessionId, 'understanding');
    }
    const history = this.sessionService.getHistory(sessionId);

    const intent = await this.extractIntent(userMessage, history);
    const inlineEntities = this.extractInlineEntities(userMessage);
    const normalizedEntities = this.normalizeEntities(
      { ...intent.entities, ...inlineEntities },
      userMessage
    );
    const normalizedCategory = this.normalizeCategory(intent.category);
    const resolvedCategory = this.resolveCategory(normalizedCategory, userMessage, normalizedEntities);
    const existingEntities = this.sessionService.getConfirmedEntities(sessionId);
    this.sessionService.mergeConfirmedEntities(sessionId, normalizedEntities);
    const explicitKeys = this.extractExplicitKeys(userMessage, inlineEntities);
    const overrideEntities = this.pickOverrideEntities(
      existingEntities,
      normalizedEntities,
      explicitKeys
    );
    if (Object.keys(overrideEntities).length > 0) {
      this.sessionService.updateConfirmedEntities(sessionId, overrideEntities);
    }
    const confirmedEntities = this.sessionService.getConfirmedEntities(sessionId);
    const effectiveIntent: Intent = {
      ...intent,
      category: resolvedCategory,
      entities: confirmedEntities,
    };
    const missingInfo = this.getMissingInfo(resolvedCategory, confirmedEntities, userMessage);
    const blueprint = this.buildBlueprint(userMessage, resolvedCategory, confirmedEntities, missingInfo);
    this.sessionService.setIntent(sessionId, effectiveIntent);
    this.sessionService.setBlueprint(sessionId, blueprint);
    this.sessionService.setWorkflowSummary(sessionId, undefined);
    this.sessionService.setConfirmed(sessionId, false);
    this.sessionService.clearWorkflow(sessionId);

    logger.debug('IntakeAgent: intent summary', {
      sessionId,
      category: resolvedCategory,
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
      this.agentLogger.logSummaryGeneration({
        sessionId: session.id,
        turnCount: this.sessionService.getUserTurnCount(sessionId),
        confirmedEntities,
        missingInfo,
        summary,
      });
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

    const question = await this.generateGuidanceQuestion(resolvedCategory, confirmedEntities, missingInfo);
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

    const previousPhase = session.phase;
    if (previousPhase !== 'generating') {
      this.agentLogger.logPhaseChange({
        sessionId: session.id,
        from: previousPhase,
        to: 'generating',
      });
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
        { maxIterations: IntakeAgent.CONFIRM_WORKFLOW_ITERATIONS }
      );

      if (result.success && result.workflow) {
        this.sessionService.setWorkflow(sessionId, result.workflow);
        this.sessionService.setConfirmed(sessionId, true);
        this.sessionService.setPhase(sessionId, 'deploying');
        this.agentLogger.logPhaseChange({
          sessionId: session.id,
          from: 'generating',
          to: 'deploying',
        });
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
          this.agentLogger.logPhaseChange({
            sessionId: session.id,
            from: 'generating',
            to: 'understanding',
          });
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
    this.agentLogger.logPhaseChange({
      sessionId: session.id,
      from: 'generating',
      to: 'understanding',
    });
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
        return;
      }
      if (field === 'speech_content' && this.isGenericSpeechContent(confirmedEntities[field])) {
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

    const gesture = this.findGestureKeyword(message);
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

  private resolveCategory(
    category: Intent['category'],
    message: string,
    entities: Record<string, string>
  ): Intent['category'] {
    if (category && category !== 'custom') {
      return category;
    }
    if (entities.game_type || message.includes('石头剪刀布')) {
      return 'game_interaction';
    }
    if (entities.emotion_mode || message.includes('情感') || message.includes('共情')) {
      return 'emotion_interaction';
    }
    if (entities.person_name || entities.gesture || message.includes('识别') || message.includes('见到')) {
      return 'face_recognition_action';
    }
    return category || 'custom';
  }

  private normalizeCategory(category?: string): Intent['category'] {
    const normalized = (category ?? 'custom').trim().toLowerCase();
    if (['face_recognition_action', 'face-recognition-action', 'face_recognition', 'face recognition'].includes(normalized)) {
      return 'face_recognition_action';
    }
    if (['emotion_interaction', 'emotion-interaction', 'emotion'].includes(normalized)) {
      return 'emotion_interaction';
    }
    if (['game_interaction', 'game-interaction', 'game'].includes(normalized)) {
      return 'game_interaction';
    }
    if (['custom'].includes(normalized)) {
      return 'custom';
    }
    return 'custom';
  }

  private normalizeEntities(entities: Record<string, string>, message: string): Record<string, string> {
    const normalized: Record<string, string> = {};
    Object.entries(entities).forEach(([key, value]) => {
      if (!value) {
        return;
      }
      if (key === 'person_name') {
        const person = this.normalizePersonName(value, message);
        if (person) {
          normalized.person_name = person;
        }
        return;
      }
      if (key === 'gesture') {
        const gesture = this.normalizeGesture(value);
        if (gesture) {
          normalized.gesture = gesture;
        }
        return;
      }
      if (key === 'speech_content') {
        const speech = this.normalizeSpeechContent(value, message);
        if (speech) {
          normalized.speech_content = speech;
        }
        return;
      }
      if (key === 'tts_voice') {
        normalized.tts_voice = value.toLowerCase();
        return;
      }
      normalized[key] = value;
    });
    return normalized;
  }

  private normalizePersonName(value: string, message: string): string {
    const cleaned = value.replace(/[，,。！？!?\s]/g, '');
    const candidates = Array.from(message.matchAll(/老[\u4e00-\u9fa5]{1,2}/g)).map((m) => m[0]);
    const candidate = candidates[0] ?? cleaned;
    const suffixes = ['竖', '比', '举', '做', '打', '挥', '招', '握', '骂', '喊', '说', '见'];
    if (candidate.length >= 3 && suffixes.includes(candidate[candidate.length - 1])) {
      return candidate.slice(0, -1);
    }
    return candidate;
  }

  private normalizeGesture(value: string): string {
    const normalized = value.replace(/\s/g, '');
    if (/竖.*中指|中指/.test(normalized)) {
      return '中指';
    }
    if (/比.*V|V手势|V/.test(normalized)) {
      return 'V';
    }
    if (/点赞|大拇指/.test(normalized)) {
      return '大拇指';
    }
    if (/挥手|招手/.test(normalized)) {
      return '挥手';
    }
    if (/握手/.test(normalized)) {
      return '握手';
    }
    return value;
  }

  private normalizeSpeechContent(value: string, message: string): string {
    const quoteMatch = message.match(/["“]([^"”]{1,20})["”]/);
    if (quoteMatch?.[1]) {
      return quoteMatch[1];
    }
    const trimmed = value.trim();
    if (this.isGenericSpeechContent(trimmed)) {
      return '';
    }
    return trimmed;
  }

  private isGenericSpeechContent(value: string): boolean {
    const normalized = value.replace(/\s/g, '');
    return (
      ['骂人', '打招呼', '问候', '问好', '寒暄', '打声招呼', '说话', '聊天'].includes(normalized)
    );
  }

  private extractExplicitKeys(message: string, inlineEntities: Record<string, string>): Set<string> {
    const keys = new Set(Object.keys(inlineEntities));
    if (message.match(/["“]([^"”]{1,20})["”]/)) {
      keys.add('speech_content');
    }
    if (message.match(/音色\s*[abc]/i)) {
      keys.add('tts_voice');
    }
    if (message.match(/(?:叫|名字是|名叫)/)) {
      keys.add('person_name');
    }
    if (this.findGestureKeyword(message)) {
      keys.add('gesture');
    }
    if (message.includes('说') || message.includes('具体说')) {
      keys.add('speech_content');
    }
    return keys;
  }

  private pickOverrideEntities(
    existing: Record<string, string>,
    incoming: Record<string, string>,
    explicitKeys: Set<string>
  ): Record<string, string> {
    const overrides: Record<string, string> = {};
    Object.entries(incoming).forEach(([key, value]) => {
      if (!value) {
        return;
      }
      const current = existing[key];
      if (!current || current === value) {
        return;
      }
      if (explicitKeys.has(key)) {
        overrides[key] = value;
        return;
      }
      if (key === 'speech_content') {
        const currentGeneric = this.isGenericSpeechContent(current);
        const nextGeneric = this.isGenericSpeechContent(value);
        if (currentGeneric && !nextGeneric) {
          overrides[key] = value;
        }
      }
    });
    return overrides;
  }

  private findGestureKeyword(message: string): string | null {
    const gestureKeywords = ['竖中指', '比个V', '比V', '点赞', '挥手', '招手', '握手'];
    return gestureKeywords.find((keyword) => message.includes(keyword)) ?? null;
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
