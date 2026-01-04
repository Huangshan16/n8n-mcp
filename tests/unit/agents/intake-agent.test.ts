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
        llmTimeoutMs: 1000,
        workflowCacheTtlSeconds: 300,
        maxIterations: 2,
        promptVariant: 'baseline',
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

  it('returns summary when missing info resolved', async () => {
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
    const workflowArchitect = {
      generateWorkflow: vi.fn().mockResolvedValue({
        success: true,
        workflow: { name: 'RPS', nodes: [], connections: {} },
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
        llmTimeoutMs: 1000,
        workflowCacheTtlSeconds: 300,
        maxIterations: 2,
        promptVariant: 'baseline',
      },
      llmClient as any,
      workflowArchitect as any,
      hardwareService,
      sessionService,
      []
    );

    const session = sessionService.getOrCreate();
    const response = await agent.processUserInput('我要玩石头剪刀布', session.id);

    expect(response.type).toBe('summary_ready');
    expect(response.blueprint?.intentSummary).toContain('石头剪刀布');
    expect(response.metadata?.showConfirmBuildButton).toBe(true);
    expect(workflowArchitect.generateWorkflow).not.toHaveBeenCalled();
  });

  it('retries workflow generation on confirm up to max attempts', async () => {
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
    const workflowArchitect = {
      generateWorkflow: vi
        .fn()
        .mockResolvedValue({
          success: false,
          workflow: undefined,
          validationResult: { isValid: false, errors: [{ message: 'invalid workflow' }] },
          iterations: 1,
          reasoning: '',
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
        llmTimeoutMs: 1000,
        workflowCacheTtlSeconds: 300,
        maxIterations: 2,
        promptVariant: 'baseline',
      },
      llmClient as any,
      workflowArchitect as any,
      hardwareService,
      sessionService,
      []
    );

    const session = sessionService.getOrCreate();
    await agent.processUserInput('我要玩石头剪刀布', session.id);
    const response = await agent.confirmBlueprint(session.id);

    expect(workflowArchitect.generateWorkflow).toHaveBeenCalledTimes(3);
    expect(response.type).toBe('guidance');
  });
});
