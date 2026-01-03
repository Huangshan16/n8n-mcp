import { describe, expect, it } from 'vitest';
import { HardwareService } from '../../../src/agents/hardware-service';
import { Intent } from '../../../src/agents/types';

const service = new HardwareService();

describe('HardwareService', () => {
  it('infers components from intent entities', () => {
    const intent: Intent = {
      category: 'robot_task',
      subCategory: 'face_recognition_action',
      entities: [
        { type: 'action', value: '竖中指' },
        { type: 'speech', value: '滚' },
      ],
      confidence: 0.9,
    };

    const components = service.inferComponentsFromIntent(intent);
    expect(components).toContain('mechanical_hand');
    expect(components).toContain('speaker');
    expect(components).toContain('camera');
  });

  it('returns hardware definitions by name', async () => {
    const component = await service.getComponentByName('camera');
    expect(component?.displayName).toBe('摄像头');
  });
});
