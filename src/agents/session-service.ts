import { randomUUID } from 'crypto';
import { AgentSession, ConversationTurn } from './types';
import { logger } from '../utils/logger';

export interface SessionServiceOptions {
  ttlMs?: number;
  maxTurns?: number;
}

export class SessionService {
  private sessions = new Map<string, AgentSession>();
  private ttlMs: number;
  private maxTurns: number;

  constructor(options: SessionServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.maxTurns = options.maxTurns ?? 6;
  }

  getOrCreate(sessionId?: string): AgentSession {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) {
        this.refresh(existing);
        return existing;
      }
    }

    const now = new Date().toISOString();
    const id = sessionId || randomUUID();
    const session: AgentSession = {
      id,
      history: [],
      confirmed: false,
      userTurns: 0,
      lastSummaryTurn: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: this.getExpiryIso(),
    };
    this.sessions.set(id, session);
    logger.debug('SessionService: created session', { sessionId: id });
    return session;
  }

  appendTurn(sessionId: string, role: ConversationTurn['role'], content: string): AgentSession {
    const session = this.getOrCreate(sessionId);
    session.history.push({ role, content });
    if (role === 'user') {
      session.userTurns += 1;
    }

    if (session.history.length > this.maxTurns * 2) {
      session.history.splice(0, session.history.length - this.maxTurns * 2);
    }

    this.refresh(session);
    logger.debug('SessionService: appended turn', {
      sessionId,
      role,
      totalTurns: session.history.length,
    });
    return session;
  }

  getHistory(sessionId: string): ConversationTurn[] {
    const session = this.getSession(sessionId);
    return session ? [...session.history] : [];
  }

  getUserTurnCount(sessionId: string): number {
    return this.getSession(sessionId)?.userTurns ?? 0;
  }

  markSummary(sessionId: string): void {
    const session = this.getOrCreate(sessionId);
    session.lastSummaryTurn = session.userTurns;
    this.refresh(session);
  }

  shouldSummarize(sessionId: string, cadence: number): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }
    return session.userTurns > 0 && session.userTurns % cadence === 0 && session.lastSummaryTurn !== session.userTurns;
  }

  setWorkflow(sessionId: string, workflow: AgentSession['workflow']): void {
    const session = this.getOrCreate(sessionId);
    session.workflow = workflow;
    this.refresh(session);
    logger.debug('SessionService: stored workflow', { sessionId, workflowName: workflow?.name });
  }

  getWorkflow(sessionId: string): AgentSession['workflow'] | null {
    const session = this.getSession(sessionId);
    return session?.workflow ?? null;
  }

  clearWorkflow(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }
    session.workflow = undefined;
    this.refresh(session);
    logger.debug('SessionService: cleared workflow', { sessionId });
  }

  setIntent(sessionId: string, intent: AgentSession['intent']): void {
    const session = this.getOrCreate(sessionId);
    session.intent = intent;
    this.refresh(session);
    logger.debug('SessionService: stored intent', { sessionId, category: intent?.category });
  }

  getIntent(sessionId: string): AgentSession['intent'] | null {
    const session = this.getSession(sessionId);
    return session?.intent ?? null;
  }

  clearIntent(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }
    session.intent = undefined;
    this.refresh(session);
    logger.debug('SessionService: cleared intent', { sessionId });
  }

  setBlueprint(sessionId: string, blueprint: AgentSession['blueprint']): void {
    const session = this.getOrCreate(sessionId);
    session.blueprint = blueprint;
    this.refresh(session);
    logger.debug('SessionService: stored blueprint', { sessionId });
  }

  getBlueprint(sessionId: string): AgentSession['blueprint'] | null {
    const session = this.getSession(sessionId);
    return session?.blueprint ?? null;
  }

  clearBlueprint(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) {
      return;
    }
    session.blueprint = undefined;
    this.refresh(session);
    logger.debug('SessionService: cleared blueprint', { sessionId });
  }

  setConfirmed(sessionId: string, confirmed: boolean): void {
    const session = this.getOrCreate(sessionId);
    session.confirmed = confirmed;
    this.refresh(session);
    logger.debug('SessionService: updated confirmation', { sessionId, confirmed });
  }

  isConfirmed(sessionId: string): boolean {
    const session = this.getSession(sessionId);
    return session?.confirmed ?? false;
  }

  getSession(sessionId: string): AgentSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (this.isExpired(session)) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  pruneExpired(): void {
    this.sessions.forEach((session, id) => {
      if (this.isExpired(session)) {
        this.sessions.delete(id);
        logger.debug('SessionService: pruned expired session', { sessionId: id });
      }
    });
  }

  private refresh(session: AgentSession): void {
    const now = new Date().toISOString();
    session.updatedAt = now;
    session.expiresAt = this.getExpiryIso();
  }

  private getExpiryIso(): string {
    return new Date(Date.now() + this.ttlMs).toISOString();
  }

  private isExpired(session: AgentSession): boolean {
    return session.expiresAt ? new Date(session.expiresAt).getTime() <= Date.now() : false;
  }
}
