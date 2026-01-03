import { AgentConfig, loadAgentConfig } from '../agents/agent-config';
import { CommandGenerator } from '../agents/command-generator';
import { HardwareService } from '../agents/hardware-service';
import { IntakeAgent } from '../agents/intake-agent';
import { IntentClassifier } from '../agents/intent-classifier';
import { createLLMClient, LLMClient } from '../agents/llm-client';
import { ScenarioMatcher } from '../agents/scenario-matcher';
import { ScenarioRepository } from '../agents/scenario-repository';
import { SessionService } from '../agents/session-service';
import { logger } from '../utils/logger';
import { AgentService } from './agent-service';

export interface AgentStackOptions {
  config?: AgentConfig;
  llmClient?: LLMClient;
  scenarioDbPath?: string;
  seed?: boolean;
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
  const scenarioRepository = await ScenarioRepository.create({
    dbPath: options.scenarioDbPath,
    seed: options.seed,
  });
  const hardwareService = new HardwareService();
  const scenarioMatcher = new ScenarioMatcher(scenarioRepository, hardwareService);
  const intentClassifier = new IntentClassifier(llmClient, { fallbackOnError: true });
  const commandGenerator = new CommandGenerator();
  const sessionService = new SessionService({
    maxTurns: config.maxConversationTurns,
  });

  const intakeAgent = new IntakeAgent(
    config,
    llmClient,
    intentClassifier,
    scenarioMatcher,
    commandGenerator,
    sessionService
  );

  const agentService = new AgentService(intakeAgent, sessionService);

  return {
    agentService,
    scenarioRepository,
    sessionService,
  };
}
