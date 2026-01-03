import { describe, expect, it, vi } from 'vitest';
import { ScenarioMatcher } from '../../../src/agents/scenario-matcher';
import { HardwareService } from '../../../src/agents/hardware-service';
import { DEFAULT_SCENARIOS } from '../../../src/agents/scenario-seeds';
import { Intent } from '../../../src/agents/types';

const repository = {
  findByIntent: vi.fn(),
};

describe('ScenarioMatcher', () => {
  it('matches face-gesture scenario and fills params', async () => {
    repository.findByIntent.mockResolvedValueOnce(DEFAULT_SCENARIOS);

    const matcher = new ScenarioMatcher(repository, new HardwareService());
    const intent: Intent = {
      category: 'robot_task',
      subCategory: 'face_recognition_action',
      entities: [
        { type: 'person', value: '老刘' },
        { type: 'action', value: '竖中指' },
        { type: 'speech', value: '滚' },
      ],
      confidence: 0.95,
    };

    const results = await matcher.match(intent);

    expect(results[0].id).toBe('face-gesture-interaction');

    const personParam = results[0].requiredParams.find((param) => param.name === 'person_name');
    expect(personParam?.value).toBe('老刘');
  });
});
