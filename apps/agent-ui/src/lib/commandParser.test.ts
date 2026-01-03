import { describe, expect, it } from 'vitest';
import { parseCommandText } from './commandParser';

describe('commandParser', () => {
  it('parses workflow command payload', () => {
    const text = '#CREATE_WORKFLOW:{"scenarioId":"demo","params":{"a":1},"displayText":"Run"}';
    const command = parseCommandText(text);

    expect(command?.scenarioId).toBe('demo');
    expect(command?.params.a).toBe(1);
    expect(command?.displayText).toBe('Run');
  });
});
