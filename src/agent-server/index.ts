#!/usr/bin/env node

import { logger } from '../utils/logger';
import { createAgentStack } from './agent-factory';
import { AgentHttpServer } from './server';
import { WorkflowDeployer } from '../agents/workflow-service';

async function main() {
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
