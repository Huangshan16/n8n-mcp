import { describe, expect, it } from 'vitest';
import { CommandGenerator } from '../../../src/agents/command-generator';
import { DEFAULT_SCENARIOS } from '../../../src/agents/scenario-seeds';

const generator = new CommandGenerator();

describe('CommandGenerator', () => {
  it('serializes command instructions', () => {
    const scenario = {
      ...DEFAULT_SCENARIOS[0],
      requiredParams: DEFAULT_SCENARIOS[0].requiredParams.map((param) => ({
        ...param,
        value: param.name === 'person_name' ? '老刘' : '测试',
      })),
    };

    const command = generator.generate(scenario);
    const serialized = generator.serializeCommand(command);

    expect(command.command).toBe('CREATE_WORKFLOW');
    expect(command.params.person_name).toBe('老刘');
    expect(serialized).toContain('#CREATE_WORKFLOW:');
  });
});
