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

  it('stores and retrieves intent and confirmation state', () => {
    const service = new SessionService();
    const session = service.getOrCreate();
    const intent = { category: 'custom', entities: {}, confidence: 0.8 };

    service.setIntent(session.id, intent);
    expect(service.getIntent(session.id)).toEqual(intent);
    expect(service.isConfirmed(session.id)).toBe(false);

    service.setConfirmed(session.id, true);
    expect(service.isConfirmed(session.id)).toBe(true);

    service.clearIntent(session.id);
    expect(service.getIntent(session.id)).toBeNull();
  });

  it('stores and retrieves blueprint in session', () => {
    const service = new SessionService();
    const session = service.getOrCreate();
    const blueprint = {
      intentSummary: 'demo',
      triggers: [],
      logic: [],
      executors: [],
      missingFields: ['gesture'],
    };

    service.setBlueprint(session.id, blueprint);
    expect(service.getBlueprint(session.id)).toEqual(blueprint);
    service.clearBlueprint(session.id);
    expect(service.getBlueprint(session.id)).toBeNull();
  });

  it('tracks user turn cadence for summaries', () => {
    const service = new SessionService();
    const session = service.getOrCreate();

    service.appendTurn(session.id, 'user', 'one');
    service.appendTurn(session.id, 'assistant', 'a');
    service.appendTurn(session.id, 'user', 'two');
    service.appendTurn(session.id, 'assistant', 'b');
    service.appendTurn(session.id, 'user', 'three');

    expect(service.getUserTurnCount(session.id)).toBe(3);
    expect(service.shouldSummarize(session.id, 3)).toBe(true);
    service.markSummary(session.id);
    expect(service.shouldSummarize(session.id, 3)).toBe(false);
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
