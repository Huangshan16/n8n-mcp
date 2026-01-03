import { loadAgentConfig } from '../src/agents/agent-config';
import { createLLMClient } from '../src/agents/llm-client';

const INTENT_CLASSIFICATION_PROMPT = `
你是一个机器人场景意图分类专家。你的任务是分析用户的自然语言输入，识别以下信息：

1. 意图类别 (category):
   - "robot_task": 用户想要机器人执行特定任务
   - "greeting": 用户在打招呼或闲聊
   - "hardware_query": 用户询问硬件组件能力
   - "workflow_edit": 用户想修改已有工作流

2. 子类别 (subCategory) - 仅当 category 为 "robot_task" 时:
   - "face_recognition_action": 识别人脸后执行动作
   - "emotion_interaction": 情感交互
   - "game_interaction": 游戏互动
   - "voice_interaction": 语音交互
   - "gesture_recognition": 手势识别
   - "autonomous_navigation": 自主导航

3. 实体提取 (entities):
   提取关键信息如:
   - 人名 (type: "person", value: "老刘")
   - 动作 (type: "action", value: "竖中指")
   - 语音内容 (type: "speech", value: "你好")
   - 情感状态 (type: "emotion", value: "高兴")
   - 硬件组件 (type: "hardware", value: "camera")

4. 置信度 (confidence): 0-1 之间的数值

输出严格 JSON。
`;

async function run() {
  const config = loadAgentConfig();
  const client = createLLMClient(config);
  const input = '见到老刘竖个中指骂人';

  const result = await client.classify(INTENT_CLASSIFICATION_PROMPT, input);
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
