export const FEW_SHOT_EXAMPLES = [
  {
    title: '个性化手势交互',
    userIntent: '见到老刘竖个中指骂人',
    topology: '触发器 → 人脸识别 → IF(识别到老刘) → 机械手动作 → 喇叭播报',
  },
  {
    title: '情感交互',
    userIntent: '当我难过时安慰我',
    topology: '触发器 → 情绪识别 → IF(负向) → 屏幕表情 → 喇叭语音',
  },
  {
    title: '石头剪刀布',
    userIntent: '我想玩石头剪刀布',
    topology: '触发器 → 摄像头手势识别 → 计算胜负 → 喇叭播报',
  },
];
