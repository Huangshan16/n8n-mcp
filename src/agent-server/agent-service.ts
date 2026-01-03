import { IntakeAgent } from '../agents/intake-agent';
import { SessionService } from '../agents/session-service';
import { AgentResponse } from '../agents/types';
import { logger } from '../utils/logger';

export class AgentService {
  constructor(private intakeAgent: IntakeAgent, private sessionService: SessionService) {}

  async chat(message: string, sessionId?: string): Promise<{ sessionId: string; response: AgentResponse }> {
    logger.debug('AgentService: chat request', {
      sessionId: sessionId ?? null,
      messageLength: message.length,
    });
    const session = this.sessionService.getOrCreate(sessionId);
    const response = await this.intakeAgent.processUserInput(message, session.id);
    logger.debug('AgentService: chat response', {
      sessionId: session.id,
      responseType: response.type,
    });
    return { sessionId: session.id, response };
  }

  getSession(sessionId: string) {
    return this.sessionService.getSession(sessionId);
  }
}
