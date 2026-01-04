import express from 'express';
import cors from 'cors';
import http from 'http';
import { AgentService } from './agent-service';
import { WorkflowDeployer } from '../agents/workflow-service';
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
    private workflowDeployer: WorkflowDeployer
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

    app.post('/api/agent/confirm', async (req, res) => {
      const sessionId = req.body?.sessionId as string | undefined;
      if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }

      try {
        logger.debug('HTTP confirm request', { sessionId });
        const result = await this.agentService.confirm(sessionId);
        res.json(result);
      } catch (error) {
        logger.warn('HTTP confirm error', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Agent error' });
      }
    });

    app.post('/api/workflow/create', async (req, res) => {
      try {
        const workflow = req.body?.workflow as Record<string, unknown> | undefined;
        const sessionId = req.body?.sessionId as string | undefined;

        const resolvedWorkflow =
          (workflow as any) ?? (sessionId ? this.agentService.getWorkflow(sessionId) : null);

        if (!resolvedWorkflow) {
          res.status(400).json({ error: 'workflow or sessionId is required' });
          return;
        }

        logger.debug('HTTP workflow create request', {
          workflowName: resolvedWorkflow.name ?? null,
          nodeCount: Array.isArray(resolvedWorkflow.nodes) ? resolvedWorkflow.nodes.length : 0,
        });
        const result = await this.workflowDeployer.createWorkflow(resolvedWorkflow as any);
        res.json(result);
      } catch (error) {
        logger.warn('HTTP workflow create error', error);
        res.status(400).json({ error: error instanceof Error ? error.message : 'Workflow error' });
      }
    });

    this.server = http.createServer(app);
    attachWebSocketServer(this.server, this.agentService);

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
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
