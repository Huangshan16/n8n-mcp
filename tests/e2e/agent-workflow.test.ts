import { describe, expect, it, vi } from 'vitest';
import { IntakeAgent } from '../../src/agents/intake-agent';
import { SessionService } from '../../src/agents/session-service';
import { AgentService } from '../../src/agent-server/agent-service';

describe('Agent End-to-End Workflow', () => {
  it('completes a workflow creation flow', async () => {
    const llmClient = {
      chat: vi.fn(async (messages: Array<{ content: string }>) => {
        const lastMessage = messages[messages.length - 1]?.content ?? '';
        if (lastMessage === '请生成引导问题。') {
          return '请补充信息';
        }
        if (lastMessage.includes('见到老刘')) {
          return JSON.stringify({
            category: 'face_recognition_action',
            entities: { person_name: '老刘', gesture: '中指' },
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
    const workflowArchitect = {
      generateWorkflow: vi.fn().mockResolvedValue({
        success: true,
        workflow: {
          name: 'Test Workflow',
          nodes: [
            {
              id: '1',
              name: 'Webhook',
              type: 'n8n-nodes-base.webhook',
              position: [0, 0],
              parameters: {},
            },
          ],
          connections: {},
        },
        iterations: 1,
        reasoning: 'ok',
      }),
    };
    const hardwareService = { inferComponentsFromIntent: vi.fn().mockReturnValue([]) } as any;
    const sessionService = new SessionService();
    const intakeAgent = new IntakeAgent(
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
    const agentService = new AgentService(intakeAgent, sessionService);

    const first = await agentService.chat('见到老刘竖个中指骂人');
    expect(first.response.type).toBe('guidance');

    const second = await agentService.chat('傻瓜蛋，音色a', first.sessionId);
    expect(second.response.type).toBe('summary_ready');
    expect(second.response.metadata?.showConfirmBuildButton).toBe(true);

    const confirm = await agentService.confirm(second.sessionId);
    expect(confirm.response.type).toBe('workflow_ready');
    expect(confirm.response.workflow?.name).toBe('Test Workflow');
  });
});
