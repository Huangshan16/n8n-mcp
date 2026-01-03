import { HardwareComponent, Scenario } from './types';

export const DEFAULT_HARDWARE_COMPONENTS: HardwareComponent[] = [
  {
    id: 'camera',
    name: 'camera',
    displayName: '摄像头',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/camera/{{action}}',
      method: 'POST',
    },
    capabilities: ['face_recognition', 'object_detection', 'gesture_recognition', 'qr_code_scan'],
  },
  {
    id: 'mechanical_hand',
    name: 'mechanical_hand',
    displayName: '机械手',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/mechanical-hand/{{action}}',
      method: 'POST',
    },
    capabilities: ['gesture_middle_finger', 'gesture_v_sign', 'gesture_thumbs_up', 'gesture_wave', 'grasp', 'release'],
  },
  {
    id: 'speaker',
    name: 'speaker',
    displayName: '喇叭',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/speaker/tts',
      method: 'POST',
      sendBody: true,
      contentType: 'json',
      bodyParametersJson: '={{ { "text": $json.speech } }}',
    },
    capabilities: ['text_to_speech', 'play_audio', 'volume_control'],
  },
  {
    id: 'microphone',
    name: 'microphone',
    displayName: '麦克风',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/microphone/record',
      method: 'POST',
    },
    capabilities: ['voice_recording', 'speech_to_text', 'noise_cancellation'],
  },
  {
    id: 'screen',
    name: 'screen',
    displayName: '屏幕',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/screen/display',
      method: 'POST',
      sendBody: true,
      contentType: 'json',
      bodyParametersJson: '={{ { "content": $json.displayContent } }}',
    },
    capabilities: ['emoji_display', 'text_display', 'image_display'],
  },
  {
    id: 'chassis',
    name: 'chassis',
    displayName: '底盘(全向轮)',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/chassis/move',
      method: 'POST',
    },
    capabilities: ['omnidirectional_movement', 'rotation', 'speed_control'],
  },
  {
    id: 'mechanical_arm',
    name: 'mechanical_arm',
    displayName: '机械臂',
    nodeType: 'n8n-nodes-base.httpRequest',
    defaultConfig: {
      url: 'http://hardware-api/mechanical-arm/{{action}}',
      method: 'POST',
    },
    capabilities: ['lift', 'lower', 'extend', 'retract', 'rotate', 'preset_action'],
  },
];

export const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: 'face-gesture-interaction',
    name: '个性化手势交互',
    description: '识别特定人脸，触发预定义的手势和语音动作',
    intentCategory: 'robot_task',
    intentSubCategory: 'face_recognition_action',
    requiredComponents: ['camera', 'mechanical_hand', 'speaker', 'chassis'],
    requiredParams: [
      {
        name: 'person_name',
        type: 'person',
        description: '目标人物姓名',
        required: true,
      },
      {
        name: 'gesture_action',
        type: 'action',
        description: '手势动作 (如: 竖中指, 比V)',
        required: true,
      },
      {
        name: 'speech_content',
        type: 'speech',
        description: '语音内容',
        required: true,
      },
    ],
    workflowTemplate: {
      name: '{{ person_name }} 手势交互',
      nodes: [
        {
          id: 'trigger',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          name: '启动触发',
          position: [100, 200],
          parameters: {},
        },
        {
          id: 'camera_scan',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '摄像头扫描',
          position: [300, 200],
          parameters: {
            url: 'http://hardware-api/camera/scan',
            method: 'POST',
          },
        },
        {
          id: 'face_recognition',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '人脸识别',
          position: [520, 200],
          parameters: {
            url: 'http://ai-service/face/recognize',
            method: 'POST',
          },
        },
        {
          id: 'condition_check',
          type: 'n8n-nodes-base.if',
          typeVersion: 2.3,
          name: '判断人物',
          position: [740, 200],
          parameters: {
            conditions: {
              string: [
                {
                  value1: '={{ $json.name }}',
                  operation: 'equals',
                  value2: '{{ person_name }}',
                },
              ],
            },
          },
        },
        {
          id: 'gesture_control',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '手势控制',
          position: [960, 120],
          parameters: {
            url: 'http://hardware-api/mechanical-hand/{{ gesture_action }}',
            method: 'POST',
          },
        },
        {
          id: 'tts_output',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '语音输出',
          position: [1180, 120],
          parameters: {
            url: 'http://hardware-api/speaker/tts?text={{ speech_content }}',
            method: 'POST',
          },
        },
      ],
      connections: {
        trigger: { main: [[{ node: 'camera_scan', type: 'main', index: 0 }]] },
        camera_scan: { main: [[{ node: 'face_recognition', type: 'main', index: 0 }]] },
        face_recognition: { main: [[{ node: 'condition_check', type: 'main', index: 0 }]] },
        condition_check: { main: [[{ node: 'gesture_control', type: 'main', index: 0 }], []] },
        gesture_control: { main: [[{ node: 'tts_output', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    id: 'emotion-interaction',
    name: '情感交互',
    description: '通过语音和视觉识别用户情绪，输出相应的表情、语音和动作',
    intentCategory: 'robot_task',
    intentSubCategory: 'emotion_interaction',
    requiredComponents: ['camera', 'microphone', 'speaker', 'screen', 'mechanical_arm'],
    requiredParams: [
      {
        name: 'emotion_detection_mode',
        type: 'string',
        description: '情绪检测模式: voice_only, vision_only, multimodal',
        required: true,
        default: 'multimodal',
      },
      {
        name: 'response_style',
        type: 'string',
        description: '回应风格: empathetic, cheerful, calm',
        required: false,
        default: 'empathetic',
      },
    ],
    workflowTemplate: {
      name: '情感交互机器人',
      nodes: [
        {
          id: 'trigger',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2.1,
          name: '持续监听',
          position: [100, 200],
          parameters: {
            path: 'emotion-trigger',
            responseMode: 'lastNode',
          },
        },
        {
          id: 'voice_input',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '语音输入',
          position: [300, 100],
          parameters: {
            url: 'http://hardware-api/microphone/record',
            method: 'POST',
          },
        },
        {
          id: 'vision_input',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '视觉输入',
          position: [300, 300],
          parameters: {
            url: 'http://hardware-api/camera/capture',
            method: 'POST',
          },
        },
        {
          id: 'emotion_analysis',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          name: '情绪分析',
          position: [520, 200],
          parameters: {
            language: 'javaScript',
            mode: 'runOnceForAllItems',
            jsCode: "return [{ emotion: 'neutral' }];",
          },
        },
        {
          id: 'response_generator',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          name: '生成回应策略',
          position: [720, 200],
          parameters: {
            language: 'javaScript',
            mode: 'runOnceForAllItems',
            jsCode:
              "const emotion = $json.emotion || 'neutral';\nreturn [{\n  displayContent: emotion === 'happy' ? '😊' : emotion === 'sad' ? '😢' : '😐',\n  speech: emotion === 'happy' ? '你看起来很开心！' : '怎么了呀主人'\n}];",
          },
        },
        {
          id: 'screen_display',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '屏幕显示',
          position: [940, 140],
          parameters: {
            url: 'http://hardware-api/screen/display',
            method: 'POST',
          },
        },
        {
          id: 'speaker_output',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '语音输出',
          position: [940, 260],
          parameters: {
            url: 'http://hardware-api/speaker/tts?text={{ response_style }}',
            method: 'POST',
          },
        },
      ],
      connections: {
        trigger: {
          main: [[{ node: 'voice_input', type: 'main', index: 0 }, { node: 'vision_input', type: 'main', index: 0 }]],
        },
        voice_input: { main: [[{ node: 'emotion_analysis', type: 'main', index: 0 }]] },
        vision_input: { main: [[{ node: 'emotion_analysis', type: 'main', index: 0 }]] },
        emotion_analysis: { main: [[{ node: 'response_generator', type: 'main', index: 0 }]] },
        response_generator: {
          main: [[{ node: 'screen_display', type: 'main', index: 0 }, { node: 'speaker_output', type: 'main', index: 0 }]],
        },
      },
    },
  },
  {
    id: 'game-rock-paper-scissors',
    name: '石头剪刀布互动',
    description: '与用户玩石头剪刀布，通过摄像头识别手势并语音反馈结果',
    intentCategory: 'robot_task',
    intentSubCategory: 'game_interaction',
    requiredComponents: ['camera', 'speaker', 'screen', 'mechanical_hand'],
    requiredParams: [
      {
        name: 'countdown_voice',
        type: 'speech',
        description: '倒数语音',
        required: true,
        default: '三二一，出拳！',
      },
      {
        name: 'win_speech',
        type: 'speech',
        description: '机器人赢了的反馈',
        required: true,
        default: '我赢啦！',
      },
      {
        name: 'lose_speech',
        type: 'speech',
        description: '机器人输了的反馈',
        required: true,
        default: '算你厉害。',
      },
    ],
    workflowTemplate: {
      name: '石头剪刀布互动',
      nodes: [
        {
          id: 'trigger',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2.1,
          name: '开始游戏',
          position: [100, 200],
          parameters: {
            path: 'rps-trigger',
            responseMode: 'lastNode',
          },
        },
        {
          id: 'countdown',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '倒数语音',
          position: [300, 200],
          parameters: {
            url: 'http://hardware-api/speaker/tts?text={{ countdown_voice }}',
            method: 'POST',
          },
        },
        {
          id: 'capture',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '手势识别',
          position: [520, 200],
          parameters: {
            url: 'http://hardware-api/camera/gesture',
            method: 'POST',
          },
        },
        {
          id: 'decide',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          name: '输赢判断',
          position: [720, 200],
          parameters: {
            language: 'javaScript',
            mode: 'runOnceForAllItems',
            jsCode:
              "return [{ result: 'win', speech: '{{ win_speech }}', displayContent: '🎉' }];",
          },
        },
        {
          id: 'feedback',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.3,
          name: '语音反馈',
          position: [940, 200],
          parameters: {
            url: 'http://hardware-api/speaker/tts?text={{ win_speech }}',
            method: 'POST',
          },
        },
      ],
      connections: {
        trigger: { main: [[{ node: 'countdown', type: 'main', index: 0 }]] },
        countdown: { main: [[{ node: 'capture', type: 'main', index: 0 }]] },
        capture: { main: [[{ node: 'decide', type: 'main', index: 0 }]] },
        decide: { main: [[{ node: 'feedback', type: 'main', index: 0 }]] },
      },
    },
  },
];
