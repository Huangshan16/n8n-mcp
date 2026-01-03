export interface HardwareComponent {
  id: string;
  name: string;
  displayName: string;
  nodeType: string;
  defaultConfig: Record<string, unknown>;
  capabilities: string[];
  apiEndpoints?: Record<
    string,
    {
      url: string;
      method: string;
      parameters?: Record<string, unknown>;
    }
  >;
}

export const HARDWARE_COMPONENTS: HardwareComponent[] = [
  {
    id: 'camera',
    name: 'camera',
    displayName: '摄像头',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }],
      },
    },
    capabilities: [
      'face_recognition',
      'gesture_recognition'
    ],
    apiEndpoints: {
      recognize_face: { url: 'http://hardware-api/camera/face/recognize', method: 'POST' },
      detect_gesture: { url: 'http://hardware-api/camera/gesture/detect', method: 'POST' },
    },
  },
  {
    id: 'mechanical_hand',
    name: 'mechanical_hand',
    displayName: '机械手',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendHeaders: true,
    },
    capabilities: [
      'gesture_middle_finger',
      'gesture_v_sign',
      'gesture_thumbs_up',
      'gesture_wave',
      'grasp',
      'release',
    ],
    apiEndpoints: {
      middle_finger: { url: 'http://hardware-api/mechanical-hand/middle-finger', method: 'POST' },
      v_sign: { url: 'http://hardware-api/mechanical-hand/v-sign', method: 'POST' },
      thumbs_up: { url: 'http://hardware-api/mechanical-hand/thumbs-up', method: 'POST' },
    },
  },
  {
    id: 'speaker',
    name: 'speaker',
    displayName: '喇叭',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendBody: true,
      contentType: 'json',
    },
    capabilities: ['text_to_speech'],
    apiEndpoints: {
      tts: {
        url: 'http://hardware-api/speaker/tts',
        method: 'POST',
        parameters: { text: 'string' },
      },
    },
  },
  {
    id: 'microphone',
    name: 'microphone',
    displayName: '麦克风',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: { method: 'POST' },
    capabilities: ['speech_to_text'],
    apiEndpoints: {
      stt: { url: 'http://hardware-api/microphone/stt', method: 'POST' },
    },
  },
  {
    id: 'screen',
    name: 'screen',
    displayName: '屏幕',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      method: 'POST',
      sendBody: true,
      contentType: 'json',
    },
    capabilities: ['emoji_display'],
    apiEndpoints: {
      display: {
        url: 'http://hardware-api/screen/display',
        method: 'POST',
        parameters: { content: 'string', type: 'emoji' },
      },
    },
  },
  {
    id: 'chassis',
    name: 'chassis',
    displayName: '底盘(全向轮)',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: { method: 'POST' },
    capabilities: ['omnidirectional_movement', 'rotation'],
    apiEndpoints: {
      move: { url: 'http://hardware-api/chassis/move', method: 'POST' },
    },
  },
  {
    id: 'mechanical_arm',
    name: 'mechanical_arm',
    displayName: '机械臂',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: { method: 'POST' },
    capabilities: ['lift', 'lower', 'extend', 'retract', 'rotate', 'preset_action'],
    apiEndpoints: {
      action: { url: 'http://hardware-api/mechanical-arm/:action', method: 'POST' },
    },
  },
];
