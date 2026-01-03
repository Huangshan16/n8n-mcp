import { describe, expect, it, vi } from 'vitest';
import { IntakeAgent } from '../../../src/agents/intake-agent';
import { SessionService } from '../../../src/agents/session-service';

describe('IntakeAgent', () => {
  it('returns guidance when missing info', async () => {
    const llmClient = {
      chat: vi.fn().mockResolvedValue(
        JSON.stringify({
          category: 'face_recognition_action',
          entities: { person_name: '老刘' },
          confidence: 0.9,
          missingInfo: ['gesture'],
        })
      ),
    };
    const workflowArchitect = { generateWorkflow: vi.fn() } as any;
    const hardwareService = { inferComponentsFromIntent: vi.fn().mockReturnValue([]) } as any;
    const sessionService = new SessionService();
    const agent = new IntakeAgent(
      {
        llmProvider: 'openai',
        llmModel: 'test',
        llmApiKey: 'key',
        maxConversationTurns: 4,
        convergenceThreshold: 0.7,
      },
      llmClient as any,
      workflowArchitect,
      hardwareService,
      sessionService,
      []
    );

    const session = sessionService.getOrCreate();
    const response = await agent.processUserInput('见到老刘', session.id);

    expect(response.type).toBe('guidance');
    expect(workflowArchitect.generateWorkflow).not.toHaveBeenCalled();
  });

  it('returns workflow_ready when architect succeeds', async () => {
    const llmClient = {
      chat: vi.fn().mockResolvedValue(
        JSON.stringify({
          category: 'game_interaction',
          entities: { game_type: 'rps' },
          confidence: 0.9,
          missingInfo: [],
        })
      ),
    };
    const workflow = { name: 'RPS', nodes: [], connections: {} };
    const workflowArchitect = {
      generateWorkflow: vi.fn().mockResolvedValue({
        success: true,
        workflow,
        iterations: 1,
        reasoning: 'test',
      }),
    };
    const hardwareService = { inferComponentsFromIntent: vi.fn().mockReturnValue([]) } as any;
    const sessionService = new SessionService();
    const agent = new IntakeAgent(
      {
        llmProvider: 'openai',
        llmModel: 'test',
        llmApiKey: 'key',
        maxConversationTurns: 4,
        convergenceThreshold: 0.7,
      },
      llmClient as any,
      workflowArchitect as any,
      hardwareService,
      sessionService,
      []
    );

    const session = sessionService.getOrCreate();
    const response = await agent.processUserInput('我要玩石头剪刀布', session.id);

    expect(response.type).toBe('workflow_ready');
    expect(sessionService.getWorkflow(session.id)?.name).toBe('RPS');
  });
});
