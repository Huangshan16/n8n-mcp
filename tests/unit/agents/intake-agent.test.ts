import { describe, expect, it, vi } from 'vitest';
import { IntakeAgent } from '../../../src/agents/intake-agent';
import { CommandGenerator } from '../../../src/agents/command-generator';
import { AgentConfig } from '../../../src/agents/agent-config';
import { DEFAULT_SCENARIOS } from '../../../src/agents/scenario-seeds';
import { Intent } from '../../../src/agents/types';

const config: AgentConfig = {
  llmProvider: 'openai',
  llmModel: 'test-model',
  llmApiKey: 'test-key',
  maxConversationTurns: 4,
  convergenceThreshold: 0.7,
};

describe('IntakeAgent', () => {
  it('returns command when scenario is converged', async () => {
    const intent: Intent = {
      category: 'robot_task',
      subCategory: 'face_recognition_action',
      entities: [],
      confidence: 0.95,
    };

    const scenario = {
      ...DEFAULT_SCENARIOS[0],
      requiredParams: DEFAULT_SCENARIOS[0].requiredParams.map((param) => ({
        ...param,
        value: '已填写',
      })),
    };

    const llmClient = {
      classify: vi.fn(),
      chat: vi.fn(),
    };

    const intentClassifier = {
      classify: vi.fn().mockResolvedValue(intent),
    };

    const scenarioMatcher = {
      match: vi.fn().mockResolvedValue([scenario]),
    };

    const agent = new IntakeAgent(
      config,
      llmClient,
      intentClassifier as any,
      scenarioMatcher as any,
      new CommandGenerator()
    );

    const response = await agent.processUserInput('测试', 'session-1');

    expect(response.type).toBe('command_ready');
    expect(response.command?.scenarioId).toBe('face-gesture-interaction');
    expect(response.commandText).toContain('#CREATE_WORKFLOW:');
  });

  it('returns guidance when scenario is missing params', async () => {
    const intent: Intent = {
      category: 'robot_task',
      subCategory: 'face_recognition_action',
      entities: [],
      confidence: 0.95,
    };

    const scenario = {
      ...DEFAULT_SCENARIOS[0],
      requiredParams: DEFAULT_SCENARIOS[0].requiredParams.map((param) => ({
        ...param,
        value: param.name === 'person_name' ? '老刘' : null,
      })),
    };

    const llmClient = {
      classify: vi.fn(),
      chat: vi.fn().mockResolvedValue('还需要补充一下动作和语音吗？'),
    };

    const intentClassifier = {
      classify: vi.fn().mockResolvedValue(intent),
    };

    const scenarioMatcher = {
      match: vi.fn().mockResolvedValue([scenario]),
    };

    const agent = new IntakeAgent(
      config,
      llmClient,
      intentClassifier as any,
      scenarioMatcher as any,
      new CommandGenerator()
    );

    const response = await agent.processUserInput('测试', 'session-2');

    expect(response.type).toBe('guidance');
    expect(response.message).toContain('补充');
  });
});
