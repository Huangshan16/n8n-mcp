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
});
