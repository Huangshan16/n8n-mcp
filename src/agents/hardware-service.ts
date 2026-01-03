import { Intent } from './types';
import { HARDWARE_COMPONENTS, HardwareComponent } from './hardware-components';

export class HardwareService {
  async listComponents(): Promise<HardwareComponent[]> {
    return HARDWARE_COMPONENTS;
  }

  async getComponentByName(name: string): Promise<HardwareComponent | null> {
    return HARDWARE_COMPONENTS.find((component) => component.name === name) || null;
  }

  inferComponentsFromIntent(intent: Intent): string[] {
    const components = new Set<string>();

    const entries = Object.entries(intent.entities || {});
    entries.forEach(([key, value]) => {
      if (!value) {
        return;
      }

      if (key.includes('gesture') || key.includes('action')) {
        if (['竖中指', '比个V', '比V', '挥手', '握手', '招手', '点赞'].some((action) => value.includes(action))) {
          components.add('mechanical_hand');
        }
      }

      if (key.includes('speech') || key.includes('voice') || value.includes('说')) {
        components.add('speaker');
      }

      if (key.includes('hardware')) {
        if (value.includes('摄像头')) components.add('camera');
        if (value.includes('麦克风')) components.add('microphone');
        if (value.includes('喇叭')) components.add('speaker');
        if (value.includes('机械手')) components.add('mechanical_hand');
        if (value.includes('机械臂')) components.add('mechanical_arm');
        if (value.includes('屏幕')) components.add('screen');
        if (value.includes('底盘')) components.add('chassis');
      }
    });

    if (intent.category === 'face_recognition_action') {
      components.add('camera');
    }
    if (intent.category === 'emotion_interaction') {
      components.add('camera');
      components.add('microphone');
      components.add('speaker');
      components.add('screen');
    }
    if (intent.category === 'game_interaction') {
      components.add('camera');
      components.add('speaker');
    }

    return Array.from(components);
  }
}
