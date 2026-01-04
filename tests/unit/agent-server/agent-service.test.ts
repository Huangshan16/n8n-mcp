import { describe, expect, it, vi } from 'vitest';
import { AgentService } from '../../../src/agent-server/agent-service';
import { SessionService } from '../../../src/agents/session-service';


describe('AgentService', () => {
  it('returns session id and response', async () => {
    const intakeAgent = {
      processUserInput: vi.fn().mockResolvedValue({ type: 'guidance', message: 'hi' }),
    };

    const service = new AgentService(intakeAgent as any, new SessionService());
    const result = await service.chat('hello');

    expect(result.sessionId).toBeDefined();
    expect(result.response.message).toBe('hi');
  });

  it('confirms workflow using existing session', async () => {
    const intakeAgent = {
      confirmBlueprint: vi.fn().mockResolvedValue({
        type: 'workflow_ready',
        message: 'ok',
        workflow: { name: 'WF', nodes: [], connections: {} },
      }),
    };
    const sessionService = new SessionService();
    const session = sessionService.getOrCreate();
    const service = new AgentService(intakeAgent as any, sessionService);

    const result = await service.confirm(session.id);

    expect(result.sessionId).toBe(session.id);
    expect(result.response.type).toBe('workflow_ready');
  });

  it('resets session', () => {
    const intakeAgent = { processUserInput: vi.fn() };
    const sessionService = new SessionService();
    const session = sessionService.getOrCreate();
    const service = new AgentService(intakeAgent as any, sessionService);

    sessionService.appendTurn(session.id, 'user', 'hello');
    service.resetSession(session.id);

    const resetSession = sessionService.getSession(session.id);
    expect(resetSession?.history.length).toBe(0);
  });
});
