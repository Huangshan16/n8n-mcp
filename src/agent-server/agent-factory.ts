import { loadAgentConfig } from '../agents/agent-config';
import { CommandGenerator } from '../agents/command-generator';
import { HardwareService } from '../agents/hardware-service';
import { IntakeAgent } from '../agents/intake-agent';
import { IntentClassifier } from '../agents/intent-classifier';
import { createLLMClient } from '../agents/llm-client';
import { ScenarioMatcher } from '../agents/scenario-matcher';
import { ScenarioRepository } from '../agents/scenario-repository';
import { SessionService } from '../agents/session-service';
import { AgentService } from './agent-service';

export async function createAgentStack() {
  const config = loadAgentConfig();
  const llmClient = createLLMClient(config);
  const scenarioRepository = await ScenarioRepository.create();
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
