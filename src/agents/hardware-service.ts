import { Intent, HardwareComponent } from './types';
import { DEFAULT_HARDWARE_COMPONENTS } from './scenario-seeds';

export class HardwareService {
  async listComponents(): Promise<HardwareComponent[]> {
    return DEFAULT_HARDWARE_COMPONENTS;
  }

  async getComponentByName(name: string): Promise<HardwareComponent | null> {
    return DEFAULT_HARDWARE_COMPONENTS.find((component) => component.name === name) || null;
  }

  inferComponentsFromIntent(intent: Intent): string[] {
    const components = new Set<string>();

    intent.entities.forEach((entity) => {
      if (entity.type === 'action') {
        if (['竖中指', '比个V', '比V', '挥手', '握手', '招手', '点赞'].some((a) => entity.value.includes(a))) {
          components.add('mechanical_hand');
        }
      }

      if (entity.type === 'speech') {
        components.add('speaker');
      }

      if (entity.type === 'hardware') {
        if (entity.value.includes('摄像头')) components.add('camera');
        if (entity.value.includes('麦克风')) components.add('microphone');
        if (entity.value.includes('喇叭')) components.add('speaker');
        if (entity.value.includes('机械手')) components.add('mechanical_hand');
        if (entity.value.includes('机械臂')) components.add('mechanical_arm');
        if (entity.value.includes('屏幕')) components.add('screen');
        if (entity.value.includes('底盘')) components.add('chassis');
      }
    });

    if (intent.subCategory === 'face_recognition_action') {
      components.add('camera');
    }
    if (intent.subCategory === 'emotion_interaction') {
      components.add('camera');
      components.add('microphone');
      components.add('speaker');
      components.add('screen');
    }
    if (intent.subCategory === 'game_interaction') {
      components.add('camera');
      components.add('speaker');
    }

    return Array.from(components);
  }
}
