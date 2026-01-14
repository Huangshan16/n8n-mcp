import { AgentConfig } from './agent-config';
import { LLMClient } from './llm-client';
import { WorkflowArchitect } from './workflow-architect';
import { HardwareService } from './hardware-service';
import { SessionService } from './session-service';
import { randomUUID } from 'node:crypto';
import {
  AgentResponse,
  ConversationTurn,
  Intent,
  InteractionRequest,
  WorkflowBlueprint,
} from './types';
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

    if (missingInfo.length > 0) {
      const interactionResponse = this.buildInteractionResponse(
        missingInfo,
        confirmedEntities
      );
      if (interactionResponse) {
        this.sessionService.appendTurn(sessionId, 'assistant', interactionResponse.message);
        return interactionResponse;
      }
    }

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
      confirmedEntities,
      missingInfo,
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
      const interactionResponse = this.buildInteractionResponse(missingInfo, confirmedEntities);
      if (interactionResponse) {
        this.sessionService.appendTurn(sessionId, 'assistant', interactionResponse.message);
        return interactionResponse;
      }
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
        confirmedEntities: session.confirmedEntities,
        missingInfo: [],
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
      screen_emoji: '屏幕表情',
      chassis_action: '底盘动作',
      hand_gestures: '机械手手势',
      yolo_gestures: '手势识别',
      emotion_labels: '情绪分类',
      arm_actions: '机械臂动作',
      face_profiles: '人脸样本',
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

    if (this.hasAnyKeyword(message, ['语音', '音色', 'TTS', '音频'])) {
      if (!confirmedEntities.tts_voice) {
        missingFields.add('tts_voice');
      }
    }

    if (this.hasAnyKeyword(message, ['屏幕', 'emoji', '表情'])) {
      if (!confirmedEntities.screen_emoji) {
        missingFields.add('screen_emoji');
      }
    }

    if (this.hasAnyKeyword(message, ['底盘', '移动', '前进', '后退', '旋转'])) {
      if (!confirmedEntities.chassis_action) {
        missingFields.add('chassis_action');
      }
    }

    if (this.hasAnyKeyword(message, ['机械手', '手势执行', '做手势'])) {
      if (!confirmedEntities.hand_gestures) {
        missingFields.add('hand_gestures');
      }
    }

    if (this.hasAnyKeyword(message, ['yolo', 'yolov8', '手势识别'])) {
      if (!confirmedEntities.yolo_gestures) {
        missingFields.add('yolo_gestures');
      }
    }

    if (this.hasAnyKeyword(message, ['structbert', '情绪分类', '情绪识别'])) {
      if (!confirmedEntities.emotion_labels) {
        missingFields.add('emotion_labels');
      }
    }

    if (this.hasAnyKeyword(message, ['机械臂', '夹子', '钳子'])) {
      if (!confirmedEntities.arm_actions) {
        missingFields.add('arm_actions');
      }
    }

    if (this.hasAnyKeyword(message, ['人脸识别', '人脸', '人脸图片', '照片', '头像'])) {
      if (!confirmedEntities.face_profiles) {
        missingFields.add('face_profiles');
      }
    }

    return Array.from(missingFields);
  }

  private extractInlineEntities(message: string): Record<string, string> {
    const entities: Record<string, string> = {};

    const voiceMatch = message.match(/音色\s*([abc])/i);
    if (voiceMatch?.[1]) {
      entities.tts_voice = voiceMatch[1].toLowerCase();
    }

    const emoji = this.findEmojiKeyword(message);
    if (emoji && this.hasAnyKeyword(message, ['屏幕', 'emoji', '表情'])) {
      entities.screen_emoji = emoji;
    }

    const chassisAction = this.findChassisAction(message);
    if (chassisAction) {
      entities.chassis_action = chassisAction;
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

    const handGestures = this.findMultiGestures(message, ['机械手', '手势执行', '做手势']);
    if (handGestures.length > 0) {
      entities.hand_gestures = handGestures.join(',');
    }

    const yoloGestures = this.findMultiGestures(message, ['yolo', 'yolov8', '手势识别']);
    if (yoloGestures.length > 0) {
      entities.yolo_gestures = yoloGestures.join(',');
    }

    const emotionLabels = this.findEmotionLabels(message);
    if (emotionLabels.length > 0) {
      entities.emotion_labels = emotionLabels.join(',');
    }

    const armActions = this.findArmActions(message);
    if (armActions.length > 0) {
      entities.arm_actions = armActions.join(',');
    }

    const faceProfiles = this.findFaceProfiles(message);
    if (faceProfiles.length > 0) {
      entities.face_profiles = faceProfiles.join(',');
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
    if (this.findEmojiKeyword(message)) {
      keys.add('screen_emoji');
    }
    if (this.findChassisAction(message)) {
      keys.add('chassis_action');
    }
    if (message.match(/(?:叫|名字是|名叫)/)) {
      keys.add('person_name');
    }
    if (this.findGestureKeyword(message)) {
      keys.add('gesture');
    }
    if (this.findMultiGestures(message, ['机械手', '手势执行', '做手势']).length > 0) {
      keys.add('hand_gestures');
    }
    if (this.findMultiGestures(message, ['yolo', 'yolov8', '手势识别']).length > 0) {
      keys.add('yolo_gestures');
    }
    if (this.findEmotionLabels(message).length > 0) {
      keys.add('emotion_labels');
    }
    if (this.findArmActions(message).length > 0) {
      keys.add('arm_actions');
    }
    if (this.findFaceProfiles(message).length > 0) {
      keys.add('face_profiles');
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

  private findEmojiKeyword(message: string): string | null {
    const emojis = ['开心', '难过', '愤怒'];
    return emojis.find((emoji) => message.includes(emoji)) ?? null;
  }

  private findChassisAction(message: string): string | null {
    if (message.includes('顺时针旋转90') || message.includes('顺时针旋转90°')) {
      return '顺时针旋转90°';
    }
    if (message.includes('前进')) {
      return '前进';
    }
    if (message.includes('后退')) {
      return '后退';
    }
    return null;
  }

  private findMultiGestures(message: string, requiredKeywords: string[]): string[] {
    if (!this.hasAnyKeyword(message, requiredKeywords)) {
      return [];
    }
    const gestures = ['石头', '剪刀', '布', '中指', '手势V', '大拇指'];
    const normalized = message.replace(/v/gi, 'V');
    return gestures.filter((gesture) => normalized.includes(gesture));
  }

  private findEmotionLabels(message: string): string[] {
    if (!this.hasAnyKeyword(message, ['structbert', '情绪分类', '情绪识别'])) {
      return [];
    }
    const labels = ['开心', '难过', '微笑'];
    return labels.filter((label) => message.includes(label));
  }

  private findArmActions(message: string): string[] {
    if (!this.hasAnyKeyword(message, ['机械臂', '夹子', '钳子'])) {
      return [];
    }
    const actions = ['放下', '抬起同时反复夹两下钳子', '挥挥钳子'];
    return actions.filter((action) => message.includes(action));
  }

  private findFaceProfiles(message: string): string[] {
    if (!this.hasAnyKeyword(message, ['人脸识别', '人脸', '人脸图片', '照片', '头像'])) {
      return [];
    }
    const profiles = ['老刘', '老付', '老王'];
    return profiles.filter((profile) => message.includes(profile));
  }

  private hasAnyKeyword(message: string, keywords: string[]): boolean {
    const normalized = message.toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
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

  private buildInteractionResponse(
    missingInfo: string[],
    confirmedEntities: Record<string, string>
  ): AgentResponse | null {
    const prompt = this.buildInteractionPrompt(missingInfo, confirmedEntities);
    if (!prompt) {
      return null;
    }

    const type =
      prompt.mode === 'single'
        ? 'select_single'
        : prompt.mode === 'multi'
          ? 'select_multi'
          : 'image_upload';

    return {
      type,
      message: prompt.description ?? prompt.title,
      interaction: prompt,
      confirmedEntities,
      missingInfo,
      metadata: {
        showContinueButton: false,
        showConfirmBuildButton: false,
      },
    };
  }

  private buildInteractionPrompt(
    missingInfo: string[],
    confirmedEntities: Record<string, string>
  ): InteractionRequest | null {
    const priority: Array<{
      field: InteractionRequest['field'];
      mode: InteractionRequest['mode'];
      title: string;
      description: string;
      options: Array<{ label: string; value: string }>;
      allowUpload?: boolean;
      uploadHint?: string;
    }> = [
      {
        field: 'face_profiles',
        mode: 'image',
        title: '上传人脸图片',
        description: '请选择人物并上传对应人脸图片',
        options: [
          { label: '老刘', value: '老刘' },
          { label: '老付', value: '老付' },
          { label: '老王', value: '老王' },
        ],
        allowUpload: true,
        uploadHint: '支持 png/jpg，建议清晰正脸照片',
      },
      {
        field: 'tts_voice',
        mode: 'single',
        title: '请选择音色',
        description: 'TTS 节点需要选择音色',
        options: [
          { label: '音色 a', value: 'a' },
          { label: '音色 b', value: 'b' },
          { label: '音色 c', value: 'c' },
        ],
      },
      {
        field: 'screen_emoji',
        mode: 'single',
        title: '请选择显示的 emoji',
        description: '屏幕需要显示的 emoji',
        options: [
          { label: '开心', value: '开心' },
          { label: '难过', value: '难过' },
          { label: '愤怒', value: '愤怒' },
        ],
      },
      {
        field: 'chassis_action',
        mode: 'single',
        title: '请选择底盘动作',
        description: '底盘（全向轮）需要执行的动作',
        options: [
          { label: '前进', value: '前进' },
          { label: '后退', value: '后退' },
          { label: '顺时针旋转90°', value: '顺时针旋转90°' },
        ],
      },
      {
        field: 'hand_gestures',
        mode: 'multi',
        title: '请选择机械手手势',
        description: '机械手执行手势（可多选）',
        options: [
          { label: '石头', value: '石头' },
          { label: '剪刀', value: '剪刀' },
          { label: '布', value: '布' },
          { label: '中指', value: '中指' },
          { label: '手势V', value: '手势V' },
          { label: '大拇指', value: '大拇指' },
        ],
      },
      {
        field: 'yolo_gestures',
        mode: 'multi',
        title: '请选择需要识别的手势',
        description: 'yolov8 手势识别（可多选）',
        options: [
          { label: '剪刀', value: '剪刀' },
          { label: '石头', value: '石头' },
          { label: '布', value: '布' },
          { label: '中指', value: '中指' },
          { label: '手势V', value: '手势V' },
          { label: '大拇指', value: '大拇指' },
        ],
      },
      {
        field: 'emotion_labels',
        mode: 'multi',
        title: '请选择识别的情绪',
        description: 'StructBERT 情绪分类（可多选）',
        options: [
          { label: '开心', value: '开心' },
          { label: '难过', value: '难过' },
          { label: '微笑', value: '微笑' },
        ],
      },
      {
        field: 'arm_actions',
        mode: 'multi',
        title: '请选择机械臂动作',
        description: '机械臂执行动作（可多选）',
        options: [
          { label: '放下', value: '放下' },
          { label: '抬起同时反复夹两下钳子', value: '抬起同时反复夹两下钳子' },
          { label: '挥挥钳子', value: '挥挥钳子' },
        ],
      },
    ];

    const missingSet = new Set(missingInfo);
    const selected = (value?: string) =>
      value
        ? value
            .split(/[，,]/)
            .map((item) => item.trim())
            .filter(Boolean)
        : [];

    for (const item of priority) {
      if (!missingSet.has(item.field)) {
        continue;
      }
      const existing = confirmedEntities[item.field];
      return {
        id: randomUUID(),
        mode: item.mode,
        field: item.field,
        title: item.title,
        description: item.description,
        options: item.options,
        minSelections: 1,
        maxSelections: item.mode === 'multi' ? item.options.length : 1,
        selected: item.mode === 'multi' ? selected(existing) : existing,
        allowUpload: item.allowUpload,
        uploadHint: item.uploadHint,
      };
    }

    return null;
  }
}
