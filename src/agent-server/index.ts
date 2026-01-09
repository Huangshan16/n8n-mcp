#!/usr/bin/env node

import path from 'node:path';
import { logger } from '../utils/logger';
import { createAgentStack } from './agent-factory';
import { AgentHttpServer } from './server';
import { WorkflowDeployer } from '../agents/workflow-service';

async function main() {
  const logPath = logger.enableFileLogging({
    directory: path.resolve(process.cwd(), 'docs', 'logs'),
  });
  if (logPath) {
    logger.info('File logging enabled', { path: logPath });
  }

  const { agentService, close } = await createAgentStack();
  const workflowService = WorkflowDeployer.create();

  const server = new AgentHttpServer(agentService, workflowService);
  const { port, host } = await server.start();

  logger.info(`Agent server listening on http://${host}:${port}`);

  const shutdown = async () => {
    await server.stop();
    close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Agent server failed to start', error);
  process.exit(1);
});
