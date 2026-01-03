# Agent定义与逻辑结构
1. 定义
  - 定位：将用户需求转化成合法的 n8n 工作流
  - 步骤：
    - 确认用户需求的工作流逻辑配置intake agent
    - 校验AI 基于上下文生成的工作流validate_workflow
    - 在 n8n 实例构建工作流               Workflow Management
2. intake agent
  - agent 先确认用户需求体现在工作流的整体逻辑，再基于每个节点的配置需求向用户确认节点配置
  - 每三轮对话，Agent主动汇总上下文，输出一份对于用户需求的工作流逻辑配置的概述，同时在底部出现两个按钮：“继续交流”“确认构建”；当用户点击“确认构建”时进入validate_workflow步骤
3. validate_workflow
  - 当用户点击“确认构建”时，agent 基于用户确认的逻辑配置概述输出一份 n8n 合法的 JSON 工作流文档，并调用validate_workflow对整个工作流文档进行校验
  - 校验成功时进入Workflow Management步骤，校验失败时返回具体问题给到 Agent 让其重新生成，循环直至校验成功为止（默认尝试 3次重新生成）
4. Workflow Management
  - Agent 将已经校验完毕的 JSON 文档通过Workflow Management调用n8n 实例接口进行构建，并返回构建状态、刷新n8n前端页面以显示新构建工作流（已经实现的逻辑）

---

# Demo场景与节点边界
1. 官方定义节点
  1. 触发器节点：
    - n8n-nodes-base.webhook                # Webhook 触发器（音视频输入）
    - n8n-nodes-base.scheduleTrigger    # 定时触发器（需要配置触发时间）
  2. 逻辑器节点：
    - n8n-nodes-base.if                             # 条件分支
    - n8n-nodes-base.splitInBatches       # 批量处理/循环逻辑
  3. 执行器节点：
    - n8n-nodes-base.set                          # 数据处理（设置、添加、更改）
    - n8n-nodes-base.httpRequest          # HTTP 请求（硬件API 等自定义节点）
2. 个性化手势交互
- 用户初始输入：
  -  "见到老刘机器人竖个中指骂人，见到老付机器人比个V打招呼"
  - Agent可以询问用户细节，比如骂人的时候具体说什么
- 部署后机器人交互：
  - 机器人启动后
  - 扫描到老刘人脸，机器人触发机械手竖中指，说一句“滚”
  - 扫描到老付人脸，机器人触发机械手比个V，说“你长得好帅”
- 自定义节点配置/能力：
  1. 机械手：手势执行（需配置执行的手势[中指、手势V、大拇指]）
  2. 摄像头：视频输入（无需配置）
  3. 喇叭：音频播放（无需配置）
  4. TTS：音频生成（需配置音色[音色 a、音色 b、音色 c]）
  5. yolov8：人脸识别（需配置上传识别的人脸图片[老刘、老付、老王]）

---

# 个性化手势JSON-Schema
{
  "name": "机器人个性化手势交互",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "camera-input",
        "options": {}
      },
      "id": "9042b954-1d37-4cee-8c19-2992022992f4",
      "name": "Webhook (Camera Input)",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [
        -464,
        704
      ],
      "webhookId": "417fe2b2-d00e-454c-92ea-d110dc3f2d57"
    },
    {
      "parameters": {
        "values": {
          "string": [
            {
              "name": "imageBase64",
              "value": "={{$json.imageBase64 || $json.image || \"\"}}"
            }
          ]
        },
        "options": {}
      },
      "id": "e587da50-213e-4c42-bccb-aa5c8297baa9",
      "name": "Set Image Payload",
      "type": "n8n-nodes-base.set",
      "typeVersion": 2,
      "position": [
        -240,
        704
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{$env.YOLOV8_API_URL || \"http://ai.local/api/yolov8/identify\"}}",
        "options": {
          "timeout": 60000
        }
      },
      "id": "10a5c39c-378e-4e0f-bb3e-2348cd67e977",
      "name": "httpRequest - yolov8 识别",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [
        -16,
        704
      ]
    },
    {
      "parameters": {
        "values": {
          "string": [
            {
              "name": "person",
              "value": "={{$json.person || $json.bestMatch || $json.name || ($json.result && $json.result.person) || \"\"}}"
            }
          ],
          "number": [
            {
              "name": "confidence",
              "value": "={{$json.confidence || ($json.result && $json.result.confidence) || 0}}"
            }
          ]
        },
        "options": {}
      },
      "id": "939cca64-cb7b-4fce-865a-5f7c709d77f8",
      "name": "Set Identify Result",
      "type": "n8n-nodes-base.set",
      "typeVersion": 2,
      "position": [
        208,
        704
      ]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{$json.person}}",
              "operation": "equal",
              "value2": "老刘"
            }
          ]
        },
        "options": {}
      },
      "id": "f3006f2d-015c-447a-9fbc-e0d38bd26219",
      "name": "IF 是老刘",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [
        432,
        560
      ]
    },
    {
      "parameters": {
        "conditions": {
          "string": [
            {
              "value1": "={{$json.person}}",
              "operation": "equal",
              "value2": "老付"
            }
          ]
        },
        "options": {}
      },
      "id": "6a43550e-0747-4bae-8453-c83e7b15ca1a",
      "name": "IF 是老付",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [
        432,
        848
      ]
    },
    {
      "parameters": {
        "values": {
          "string": [
            {
              "name": "gesture",
              "value": "middle_finger"
            },
            {
              "name": "ttsVoice",
              "value": "a"
            },
            {
              "name": "text",
              "value": "滚"
            }
          ]
        },
        "options": {}
      },
      "id": "d69b57dd-b752-4da4-8128-f845f8c45526",
      "name": "Set 老刘动作与文案",
      "type": "n8n-nodes-base.set",
      "typeVersion": 2,
      "position": [
        656,
        560
      ]
    },
    {
      "parameters": {
        "values": {
          "string": [
            {
              "name": "gesture",
              "value": "v"
            },
            {
              "name": "ttsVoice",
              "value": "b"
            },
            {
              "name": "text",
              "value": "你长得好帅"
            }
          ]
        },
        "options": {}
      },
      "id": "fb515b99-282b-40b9-978c-2a413fa97303",
      "name": "Set 老付动作与文案",
      "type": "n8n-nodes-base.set",
      "typeVersion": 2,
      "position": [
        656,
        848
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{$env.ROBOT_HAND_API_URL || \"http://robot.local/api/hand/gesture\"}}",
        "options": {
          "timeout": 60000
        }
      },
      "id": "4ea31c76-5cae-4a60-9671-67765094aa77",
      "name": "httpRequest - 机械手执行手势",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [
        880,
        608
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{$env.TTS_API_URL || \"http://ai.local/api/tts\"}}",
        "options": {
          "timeout": 60000
        }
      },
      "id": "413802b7-2753-4342-a8ba-5794e661cacd",
      "name": "httpRequest - TTS 生成音频",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [
        880,
        800
      ]
    },
    {
      "parameters": {
        "values": {
          "string": [
            {
              "name": "audioUrl",
              "value": "={{$json.audioUrl || $json.url || ($json.data && $json.data.audioUrl) || \"\"}}"
            }
          ]
        },
        "options": {}
      },
      "id": "4ae9bb11-f878-4830-b88e-20f36e8bc230",
      "name": "Set Audio URL",
      "type": "n8n-nodes-base.set",
      "typeVersion": 2,
      "position": [
        1104,
        800
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{$env.SPEAKER_API_URL || \"http://robot.local/api/speaker/play\"}}",
        "options": {
          "timeout": 60000
        }
      },
      "id": "a9d57d10-742e-4df2-96aa-53fdb16a0dd7",
      "name": "httpRequest - 喇叭播放音频",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [
        1328,
        800
      ]
    }
  ],
  "pinData": {},
  "connections": {
    "Webhook (Camera Input)": {
      "main": [
        [
          {
            "node": "Set Image Payload",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Image Payload": {
      "main": [
        [
          {
            "node": "httpRequest - yolov8 识别",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "httpRequest - yolov8 识别": {
      "main": [
        [
          {
            "node": "Set Identify Result",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Identify Result": {
      "main": [
        [
          {
            "node": "IF 是老刘",
            "type": "main",
            "index": 0
          },
          {
            "node": "IF 是老付",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "IF 是老刘": {
      "main": [
        [
          {
            "node": "Set 老刘动作与文案",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "IF 是老付": {
      "main": [
        [
          {
            "node": "Set 老付动作与文案",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set 老刘动作与文案": {
      "main": [
        [
          {
            "node": "httpRequest - 机械手执行手势",
            "type": "main",
            "index": 0
          },
          {
            "node": "httpRequest - TTS 生成音频",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set 老付动作与文案": {
      "main": [
        [
          {
            "node": "httpRequest - 机械手执行手势",
            "type": "main",
            "index": 0
          },
          {
            "node": "httpRequest - TTS 生成音频",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "httpRequest - TTS 生成音频": {
      "main": [
        [
          {
            "node": "Set Audio URL",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Audio URL": {
      "main": [
        [
          {
            "node": "httpRequest - 喇叭播放音频",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1",
    "availableInMCP": false
  },
  "versionId": "843b1e76-4be6-4170-8ab0-51ec2c02288d",
  "meta": {
    "instanceId": "45754d6d5f7f2bed817205dbe77e9a7a8a3cf052118fe99a211ce0703085696d"
  },
  "id": "uvTYLTiMO9HZ6Ig5",
  "tags": [
    {
      "name": "robot",
      "id": "kWS2m1TcGY5GcRtq",
      "updatedAt": "2026-01-03T19:57:43.348Z",
      "createdAt": "2026-01-03T19:57:43.348Z"
    },
    {
      "name": "n8n",
      "id": "LSuiAO6s1BdFzJCE",
      "updatedAt": "2026-01-03T19:57:43.318Z",
      "createdAt": "2026-01-03T19:57:43.318Z"
    }
  ]
}