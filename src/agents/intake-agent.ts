import { AgentConfig } from './agent-config';
import { CommandGenerator } from './command-generator';
import { IntentClassifier } from './intent-classifier';
import { LLMClient } from './llm-client';
import { ScenarioMatcher } from './scenario-matcher';
import { SessionService } from './session-service';
import { AgentResponse, Scenario } from './types';
import { GUIDANCE_QUESTION_PROMPT } from './prompts';
import { logger } from '../utils/logger';

export class IntakeAgent {
  constructor(
    private config: AgentConfig,
    private llmClient: LLMClient,
    private intentClassifier: IntentClassifier,
    private scenarioMatcher: ScenarioMatcher,
    private commandGenerator: CommandGenerator,
    private sessionService: SessionService
  ) {}

  async processUserInput(userMessage: string, sessionId: string): Promise<AgentResponse> {
    logger.debug('IntakeAgent: processing message', { sessionId, messageLength: userMessage.length });
    this.sessionService.appendTurn(sessionId, 'user', userMessage);

    const intent = await this.intentClassifier.classify(userMessage);
    const matchedScenarios = await this.scenarioMatcher.match(intent);
    const primaryScenario = matchedScenarios[0];
    logger.debug('IntakeAgent: intent and match summary', {
      sessionId,
      intent,
      matchedCount: matchedScenarios.length,
      primaryScenarioId: primaryScenario?.id ?? null,
      primaryScenarioName: primaryScenario?.name ?? null,
    });

    if (primaryScenario && this.isConverged(primaryScenario, intent.confidence)) {
      const command = this.commandGenerator.generate(primaryScenario);
      const commandText = this.commandGenerator.serializeCommand(command);
      logger.debug('IntakeAgent: converged on scenario', {
        sessionId,
        scenarioId: primaryScenario.id,
        confidence: intent.confidence,
        requiredParams: primaryScenario.requiredParams.map((param) => ({
          name: param.name,
          value: param.value ?? param.default ?? null,
          required: param.required,
        })),
      });

      const response: AgentResponse = {
        type: 'command_ready',
        message: '已为您准备好工作流配置。点击下方按钮创建:',
        command,
        commandText,
      };

      this.sessionService.appendTurn(sessionId, 'assistant', response.message);
      return response;
    }

    const question = await this.generateGuidanceQuestion(intent, primaryScenario);
    logger.debug('IntakeAgent: guidance generated', {
      sessionId,
      questionLength: question.length,
    });
    const response: AgentResponse = {
      type: 'guidance',
      message: question,
    };

    this.sessionService.appendTurn(sessionId, 'assistant', response.message);
    return response;
  }

  private isConverged(scenario: Scenario, confidence: number): boolean {
    if (confidence < this.config.convergenceThreshold) {
      return false;
    }

    return scenario.requiredParams.every(
      (param) => !param.required || (param.value !== null && param.value !== undefined)
    );
  }

  private async generateGuidanceQuestion(intent: unknown, scenario?: Scenario): Promise<string> {
    if (!scenario) {
      return '能再具体描述一下你想让机器人做什么吗？';
    }

    const confirmedParams = scenario.requiredParams.filter((param) => param.value !== null && param.value !== undefined);
    const missingParams = scenario.requiredParams.filter((param) => param.required && (param.value === null || param.value === undefined));

    const prompt = GUIDANCE_QUESTION_PROMPT
      .replace('{intent}', JSON.stringify(intent))
      .replace('{scenarios}', JSON.stringify([scenario.name]))
      .replace('{confirmedParams}', JSON.stringify(confirmedParams.map((param) => param.name)))
      .replace('{missingParams}', JSON.stringify(missingParams.map((param) => param.description || param.name)));

    try {
      logger.debug('IntakeAgent: generating guidance with LLM', {
        scenarioId: scenario.id,
        confirmedCount: confirmedParams.length,
        missingCount: missingParams.length,
      });
      const response = await this.llmClient.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: '请生成引导问题。' },
      ]);
      if (response.trim()) {
        return response.trim();
      }
    } catch {
      logger.warn('IntakeAgent: LLM guidance failed, using fallback');
      // Fall back to heuristic question below.
    }

    if (missingParams.length === 0) {
      return '需要再补充哪些细节吗？';
    }

    const target = missingParams[0];
    return `还需要补充一下${target.description || target.name}吗？`;
  }

  // Session state is maintained by SessionService.
}
