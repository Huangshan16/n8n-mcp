import { AgentConfig, loadAgentConfig } from '../agents/agent-config';
import { HardwareService } from '../agents/hardware-service';
import { IntakeAgent } from '../agents/intake-agent';
import { createLLMClient, LLMClient } from '../agents/llm-client';
import { SessionService } from '../agents/session-service';
import { MCPClient } from '../agents/mcp-client';
import { WorkflowArchitect } from '../agents/workflow-architect';
import { HARDWARE_COMPONENTS, HardwareComponent } from '../agents/hardware-components';
import { createDatabaseAdapter } from '../database/database-adapter';
import { NodeRepository } from '../database/node-repository';
import { resolveAgentDbPath } from '../agents/agent-db-path';
import { logger } from '../utils/logger';
import { AgentService } from './agent-service';

export interface AgentStackOptions {
  config?: AgentConfig;
  llmClient?: LLMClient;
  mcpClient?: MCPClient;
  workflowArchitect?: WorkflowArchitect;
  hardwareComponents?: HardwareComponent[];
  nodeDbPath?: string;
}

export async function createAgentStack(options: AgentStackOptions = {}) {
  const config = options.config ?? loadAgentConfig();
  logger.info('Agent stack config', {
    provider: config.llmProvider,
    model: config.llmModel,
    hasBaseUrl: Boolean(config.llmBaseUrl),
    maxTurns: config.maxConversationTurns,
    convergenceThreshold: config.convergenceThreshold,
  });
  const llmClient = options.llmClient ?? createLLMClient(config);
  const hardwareService = new HardwareService();
  const hardwareComponents = options.hardwareComponents ?? HARDWARE_COMPONENTS;

  const nodeDbPath = options.nodeDbPath ?? resolveAgentDbPath();
  const nodeAdapter = options.mcpClient ? null : await createDatabaseAdapter(nodeDbPath);
  const nodeRepository = nodeAdapter ? new NodeRepository(nodeAdapter) : null;

  const mcpClient = options.mcpClient ?? new MCPClient(nodeRepository!);
  const workflowArchitect =
    options.workflowArchitect ?? new WorkflowArchitect(llmClient, mcpClient);
  const sessionService = new SessionService({
    maxTurns: config.maxConversationTurns,
  });

  const intakeAgent = new IntakeAgent(
    config,
    llmClient,
    workflowArchitect,
    hardwareService,
    sessionService,
    hardwareComponents
  );

  const agentService = new AgentService(intakeAgent, sessionService);

  return {
    agentService,
    sessionService,
    nodeRepository,
    close: () => nodeAdapter?.close(),
  };
}
