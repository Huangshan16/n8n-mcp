import { CommandInstruction, Scenario } from './types';

export class CommandGenerator {
  generate(scenario: Scenario): CommandInstruction {
    const params: Record<string, unknown> = {};

    scenario.requiredParams.forEach((param) => {
      const value = param.value ?? param.default ?? null;
      if (value !== null && value !== undefined) {
        params[param.name] = value;
      }
    });

    return {
      command: 'CREATE_WORKFLOW',
      scenarioId: scenario.id,
      params,
      displayText: `创建「${scenario.name}」工作流`,
    };
  }

  serializeCommand(command: CommandInstruction): string {
    return `#CREATE_WORKFLOW:${JSON.stringify({
      scenarioId: command.scenarioId,
      params: command.params,
      displayText: command.displayText,
    })}`;
  }
}
