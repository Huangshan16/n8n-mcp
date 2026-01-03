import express from 'express';
import cors from 'cors';
import http from 'http';
import { AgentService } from './agent-service';
import { WorkflowService } from '../agents/workflow-service';
import { ScenarioRepository } from '../agents/scenario-repository';
import { attachWebSocketServer } from './websocket';
import { logger } from '../utils/logger';

export interface AgentHttpServerOptions {
  port?: number;
  host?: string;
}

export class AgentHttpServer {
  private server?: http.Server;

  constructor(
    private agentService: AgentService,
    private workflowService: WorkflowService,
    private scenarioRepository: ScenarioRepository
  ) {}

  async start(options: AgentHttpServerOptions = {}): Promise<{ port: number; host: string }> {
    const port = options.port ?? Number(process.env.AGENT_PORT || 3005);
    const host = options.host ?? process.env.AGENT_HOST ?? '0.0.0.0';

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '1mb' }));

    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    app.post('/api/agent/chat', async (req, res) => {
      const message = req.body?.message as string | undefined;
      const sessionId = req.body?.sessionId as string | undefined;

      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      try {
        logger.debug('HTTP chat request', { sessionId: sessionId ?? null, messageLength: message.length });
        const result = await this.agentService.chat(message, sessionId);
        res.json(result);
      } catch (error) {
        logger.warn('HTTP chat error', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Agent error' });
      }
    });

    app.post('/api/workflow/create', async (req, res) => {
      const scenarioId = req.body?.scenarioId as string | undefined;
      const params = (req.body?.params as Record<string, unknown> | undefined) ?? {};

      if (!scenarioId) {
        res.status(400).json({ error: 'scenarioId is required' });
        return;
      }

      try {
        logger.debug('HTTP workflow create request', {
          scenarioId,
          paramKeys: Object.keys(params),
        });
        const result = await this.workflowService.createWorkflow(scenarioId, params);
        res.json(result);
      } catch (error) {
        logger.warn('HTTP workflow create error', error);
        res.status(400).json({ error: error instanceof Error ? error.message : 'Workflow error' });
      }
    });

    app.get('/api/scenarios', async (_req, res) => {
      try {
        const scenarios = await this.scenarioRepository.list();
        res.json({ scenarios });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Scenario error' });
      }
    });

    this.server = http.createServer(app);
    attachWebSocketServer(this.server, this.agentService);

    await new Promise<void>((resolve) => {
      this.server?.listen(port, host, () => resolve());
    });

    const address = this.server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;

    return { port: actualPort, host };
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}
