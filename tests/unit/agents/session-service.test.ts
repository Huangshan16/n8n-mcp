import { describe, expect, it } from 'vitest';
import { SessionService } from '../../../src/agents/session-service';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SessionService', () => {
  it('creates sessions and appends turns', () => {
    const service = new SessionService({ maxTurns: 1 });
    const session = service.getOrCreate();

    expect(session.id).toBeDefined();
    service.appendTurn(session.id, 'user', 'hello');
    service.appendTurn(session.id, 'assistant', 'hi');
    service.appendTurn(session.id, 'user', 'again');

    const updated = service.getSession(session.id);
    expect(updated?.history.length).toBe(2);
  });

  it('prunes expired sessions', async () => {
    const service = new SessionService({ ttlMs: 5 });
    const session = service.getOrCreate();
    service.appendTurn(session.id, 'user', 'hello');

    await delay(10);
    service.pruneExpired();

    expect(service.getSession(session.id)).toBeNull();
  });
});
