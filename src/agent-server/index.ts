#!/usr/bin/env node

import { logger } from '../utils/logger';
import { createAgentStack } from './agent-factory';
import { AgentHttpServer } from './server';
import { WorkflowService } from '../agents/workflow-service';

async function main() {
  const { agentService, scenarioRepository } = await createAgentStack();
  const workflowService = WorkflowService.createWithRepository(scenarioRepository);

  const server = new AgentHttpServer(agentService, workflowService, scenarioRepository);
  const { port, host } = await server.start();

  logger.info(`Agent server listening on http://${host}:${port}`);

  const shutdown = async () => {
    await server.stop();
    scenarioRepository.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('Agent server failed to start', error);
  process.exit(1);
});
