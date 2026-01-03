import { IntakeAgent } from '../agents/intake-agent';
import { SessionService } from '../agents/session-service';
import { AgentResponse } from '../agents/types';

export class AgentService {
  constructor(private intakeAgent: IntakeAgent, private sessionService: SessionService) {}

  async chat(message: string, sessionId?: string): Promise<{ sessionId: string; response: AgentResponse }> {
    const session = this.sessionService.getOrCreate(sessionId);
    const response = await this.intakeAgent.processUserInput(message, session.id);
    return { sessionId: session.id, response };
  }

  getSession(sessionId: string) {
    return this.sessionService.getSession(sessionId);
  }
}
