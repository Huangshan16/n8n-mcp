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

  it('summarizes every third turn even when info is missing', async () => {
    const llmClient = {
      chat: vi.fn(async (messages: Array<{ content: string }>) => {
        const lastMessage = messages[messages.length - 1]?.content ?? '';
        if (lastMessage === '请生成引导问题。') {
          return '请补充信息';
        }
        return JSON.stringify({
          category: 'face_recognition_action',
          entities: { person_name: '老刘' },
          confidence: 0.9,
        });
      }),
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
    await agent.processUserInput('见到老刘', session.id);
    await agent.processUserInput('还是老刘', session.id);
    const response = await agent.processUserInput('继续', session.id);

    expect(response.type).toBe('summary_ready');
    expect(response.metadata?.showConfirmBuildButton).toBe(false);
    expect(response.missingInfo).toContain('gesture');
  });

  it('accumulates confirmed entities across turns', async () => {
    const llmClient = {
      chat: vi.fn(async (messages: Array<{ content: string }>) => {
        const lastMessage = messages[messages.length - 1]?.content ?? '';
        if (lastMessage === '请生成引导问题。') {
          return '请补充信息';
        }
        if (lastMessage.includes('见到老刘')) {
          return JSON.stringify({
            category: 'face_recognition_action',
            entities: { person_name: '老刘' },
            confidence: 0.9,
          });
        }
        if (lastMessage.includes('竖中指')) {
          return JSON.stringify({
            category: 'face_recognition_action',
            entities: { gesture: '中指' },
            confidence: 0.9,
          });
        }
        if (lastMessage.includes('傻瓜蛋')) {
          return JSON.stringify({
            category: 'face_recognition_action',
            entities: { speech_content: '傻瓜蛋', tts_voice: 'a' },
            confidence: 0.9,
          });
        }
        return JSON.stringify({ category: 'custom', entities: {}, confidence: 0.5 });
      }),
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
    await agent.processUserInput('见到老刘', session.id);
    await agent.processUserInput('竖中指', session.id);
    const response = await agent.processUserInput('傻瓜蛋，音色a', session.id);

    expect(response.type).toBe('summary_ready');
    expect(response.confirmedEntities).toMatchObject({
      person_name: '老刘',
      gesture: '中指',
      speech_content: '傻瓜蛋',
      tts_voice: 'a',
    });
    expect(response.missingInfo).toHaveLength(0);
  });

  it('normalizes categories and asks for missing speech content', async () => {
    const llmClient = {
      chat: vi.fn(async (messages: Array<{ content: string }>) => {
        const lastMessage = messages[messages.length - 1]?.content ?? '';
        if (lastMessage === '请生成引导问题。') {
          return '请补充语音内容和音色';
        }
        return JSON.stringify({
          category: 'face_recognition_action ',
          entities: { person_name: '老刘', gesture: '中指' },
          confidence: 0.9,
        });
      }),
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
    const response = await agent.processUserInput('见到老刘竖个中指骂人', session.id);

    expect(response.type).toBe('guidance');
    expect(response.message).toContain('语音');
  });
});
