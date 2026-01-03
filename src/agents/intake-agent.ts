import { AgentConfig } from './agent-config';
import { CommandGenerator } from './command-generator';
import { IntentClassifier } from './intent-classifier';
import { LLMClient } from './llm-client';
import { ScenarioMatcher } from './scenario-matcher';
import { AgentResponse, ConversationTurn, Scenario } from './types';
import { GUIDANCE_QUESTION_PROMPT } from './prompts';

export class IntakeAgent {
  private sessions = new Map<string, ConversationTurn[]>();

  constructor(
    private config: AgentConfig,
    private llmClient: LLMClient,
    private intentClassifier: IntentClassifier,
    private scenarioMatcher: ScenarioMatcher,
    private commandGenerator: CommandGenerator
  ) {}

  async processUserInput(userMessage: string, sessionId: string): Promise<AgentResponse> {
    this.recordTurn(sessionId, 'user', userMessage);

    const intent = await this.intentClassifier.classify(userMessage);
    const matchedScenarios = await this.scenarioMatcher.match(intent);
    const primaryScenario = matchedScenarios[0];

    if (primaryScenario && this.isConverged(primaryScenario, intent.confidence)) {
      const command = this.commandGenerator.generate(primaryScenario);
      const commandText = this.commandGenerator.serializeCommand(command);

      const response: AgentResponse = {
        type: 'command_ready',
        message: '已为您准备好工作流配置。点击下方按钮创建:',
        command,
        commandText,
      };

      this.recordTurn(sessionId, 'assistant', response.message);
      return response;
    }

    const question = await this.generateGuidanceQuestion(intent, primaryScenario);
    const response: AgentResponse = {
      type: 'guidance',
      message: question,
    };

    this.recordTurn(sessionId, 'assistant', response.message);
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
      const response = await this.llmClient.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: '请生成引导问题。' },
      ]);
      if (response.trim()) {
        return response.trim();
      }
    } catch {
      // Fall back to heuristic question below.
    }

    if (missingParams.length === 0) {
      return '需要再补充哪些细节吗？';
    }

    const target = missingParams[0];
    return `还需要补充一下${target.description || target.name}吗？`;
  }

  private recordTurn(sessionId: string, role: ConversationTurn['role'], content: string): void {
    const history = this.sessions.get(sessionId) || [];
    history.push({ role, content });
    const maxTurns = this.config.maxConversationTurns;

    if (history.length > maxTurns * 2) {
      history.splice(0, history.length - maxTurns * 2);
    }

    this.sessions.set(sessionId, history);
  }
}
