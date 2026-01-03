import { describe, expect, it, vi } from 'vitest';
import { IntentClassifier } from '../../../src/agents/intent-classifier';
import { INTENT_CLASSIFICATION_PROMPT } from '../../../src/agents/prompts';
import samples from '../../fixtures/agent/intent-samples.json';
import { Intent } from '../../../src/agents/types';

const mockIntent: Intent = {
  category: 'robot_task',
  subCategory: 'face_recognition_action',
  entities: [{ type: 'person', value: '老刘' }],
  confidence: 0.9,
};

describe('IntentClassifier', () => {
  it('calls LLM with the classification prompt', async () => {
    const llmClient = {
      classify: vi.fn().mockResolvedValue(mockIntent),
      chat: vi.fn(),
    };

    const classifier = new IntentClassifier(llmClient);
    const result = await classifier.classify('见到老刘竖个中指');

    expect(llmClient.classify).toHaveBeenCalledWith(INTENT_CLASSIFICATION_PROMPT, '见到老刘竖个中指');
    expect(result.category).toBe('robot_task');
  });

  it('falls back to rule-based classification on errors', async () => {
    const llmClient = {
      classify: vi.fn().mockRejectedValue(new Error('LLM offline')),
      chat: vi.fn(),
    };

    const classifier = new IntentClassifier(llmClient, { fallbackOnError: true });
    const result = await classifier.classify('你好呀');

    expect(result.category).toBe('greeting');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies sample intents with rule-based logic', () => {
    const llmClient = {
      classify: vi.fn(),
      chat: vi.fn(),
    };

    const classifier = new IntentClassifier(llmClient);

    samples.forEach((sample) => {
      const result = classifier.classifyWithRules(sample.text);
      expect(result.category).toBe(sample.category);
      if (sample.subCategory) {
        expect(result.subCategory).toBe(sample.subCategory);
      }
    });
  });
});
