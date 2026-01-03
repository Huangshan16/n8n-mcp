import { SimpleCache } from '../utils/simple-cache';
import { LLMClient } from './llm-client';
import { Intent, IntentCategory, Entity } from './types';
import { INTENT_CLASSIFICATION_PROMPT } from './prompts';

interface IntentClassifierOptions {
  fallbackOnError?: boolean;
  cacheTtlSeconds?: number;
}

const GREETING_PATTERNS = ['你好', '嗨', '哈喽', 'hello', 'hi'];
const TASK_INDICATORS = ['机器人', '工作流', '流程', '见到', '识别', '互动', '玩', '做', '动作', '任务'];
const WORKFLOW_EDIT_PATTERNS = ['修改', '更新', '调整', '优化', '改一下', '改改'];
const HARDWARE_PATTERNS = ['摄像头', '麦克风', '喇叭', '机械手', '机械臂', '屏幕', '底盘', '硬件'];

const ACTION_PATTERNS = ['竖中指', '比个V', '比V', '挥手', '握手', '招手', '点赞'];
const EMOTION_PATTERNS = ['难过', '开心', '高兴', '共情', '伤心', '生气', '激动', '紧张'];

export class IntentClassifier {
  private fallbackOnError: boolean;
  private cache: SimpleCache;
  private cacheTtlSeconds: number;

  constructor(private llmClient: LLMClient, options: IntentClassifierOptions = {}) {
    this.fallbackOnError = options.fallbackOnError ?? true;
    this.cache = new SimpleCache();
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 600;
  }

  async classify(userMessage: string): Promise<Intent> {
    const cacheKey = `intent:${userMessage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as Intent;
    }

    try {
      const intent = await this.llmClient.classify(INTENT_CLASSIFICATION_PROMPT, userMessage);
      this.cache.set(cacheKey, intent, this.cacheTtlSeconds);
      return intent;
    } catch (error) {
      if (!this.fallbackOnError) {
        throw error;
      }

      const intent = this.classifyWithRules(userMessage);
      this.cache.set(cacheKey, intent, this.cacheTtlSeconds);
      return intent;
    }
  }

  classifyWithRules(userMessage: string): Intent {
    const message = userMessage.trim();
    const lower = message.toLowerCase();

    let category: IntentCategory = 'robot_task';
    let subCategory: string | undefined;
    let confidence = 0.6;

    const hasGreeting = GREETING_PATTERNS.some((pattern) => lower.includes(pattern));
    const hasTaskIndicators = TASK_INDICATORS.some((pattern) => message.includes(pattern));

    if (hasGreeting && !hasTaskIndicators) {
      category = 'greeting';
      confidence = 0.8;
    } else if (WORKFLOW_EDIT_PATTERNS.some((pattern) => message.includes(pattern))) {
      category = 'workflow_edit';
      confidence = 0.75;
    } else if (HARDWARE_PATTERNS.some((pattern) => message.includes(pattern))) {
      category = 'hardware_query';
      confidence = 0.75;
    }

    if (category === 'robot_task') {
      if (message.includes('石头剪刀布')) {
        subCategory = 'game_interaction';
      } else if (message.includes('共情') || message.includes('情感')) {
        subCategory = 'emotion_interaction';
      } else if (message.includes('语音') || message.includes('说话')) {
        subCategory = 'voice_interaction';
      } else if (message.includes('手势')) {
        subCategory = 'gesture_recognition';
      } else if (message.includes('导航') || message.includes('巡逻')) {
        subCategory = 'autonomous_navigation';
      } else if (
        message.includes('见到') ||
        message.includes('看到') ||
        message.includes('遇到') ||
        message.includes('识别') ||
        message.includes('人脸')
      ) {
        subCategory = 'face_recognition_action';
      }

      if (subCategory) {
        confidence = 0.85;
      }
    }

    return {
      category,
      subCategory,
      entities: this.extractEntities(message),
      confidence,
    };
  }

  private extractEntities(message: string): Entity[] {
    const entities: Entity[] = [];

    const personMatch = message.match(/(?:见到|看到|识别)([^，。！？,!.?\s]{1,4})/);
    if (personMatch?.[1]) {
      entities.push({ type: 'person', value: personMatch[1] });
    }

    const actionMatch = ACTION_PATTERNS.find((pattern) => message.includes(pattern));
    if (actionMatch) {
      entities.push({ type: 'action', value: actionMatch });
    }

    const speechMatch = message.match(/说(?:一句)?["“]?(.+?)["”]?(?:。|！|!|$)/);
    if (speechMatch?.[1]) {
      entities.push({ type: 'speech', value: speechMatch[1] });
    }

    const emotionMatch = EMOTION_PATTERNS.find((pattern) => message.includes(pattern));
    if (emotionMatch) {
      entities.push({ type: 'emotion', value: emotionMatch });
    }

    HARDWARE_PATTERNS.forEach((pattern) => {
      if (message.includes(pattern)) {
        entities.push({ type: 'hardware', value: pattern });
      }
    });

    return entities;
  }
}
