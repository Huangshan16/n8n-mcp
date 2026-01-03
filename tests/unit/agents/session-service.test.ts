import { describe, expect, it } from 'vitest';
import { SessionService } from '../../../src/agents/session-service';

describe('SessionService', () => {
  it('stores and retrieves workflow in session', () => {
    const service = new SessionService({ maxTurns: 2 });
    const session = service.getOrCreate();
    const workflow = { name: 'WF', nodes: [], connections: {} };

    service.setWorkflow(session.id, workflow);

    expect(service.getWorkflow(session.id)).toEqual(workflow);
    service.clearWorkflow(session.id);
    expect(service.getWorkflow(session.id)).toBeNull();
  });

  it('appends history and keeps max turns', () => {
    const service = new SessionService({ maxTurns: 1 });
    const session = service.getOrCreate();

    service.appendTurn(session.id, 'user', 'hello');
    service.appendTurn(session.id, 'assistant', 'hi');
    service.appendTurn(session.id, 'user', 'again');

    const history = service.getHistory(session.id);
    expect(history.length).toBe(2);
    expect(history[0].content).toBe('hi');
  });
});
