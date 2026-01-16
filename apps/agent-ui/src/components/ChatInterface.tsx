import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ConnectionStatus, BuildStatus } from '../hooks/useAgentChat';
import type { InteractionRequest, WorkflowDefinition } from '../lib/agentApi';
import { uploadFaceImage } from '../lib/agentApi';
import { BuildProgressBar } from './BuildProgressBar';
import { InteractionCard } from './InteractionCard';

const QUICK_PROMPTS = [
  '见到老刘竖个中指骂人',
  '我想做一个和我共情的机器人',
  '我想有一个和我玩石头剪刀布的机器人',
];

const NODE_LABELS: Record<string, string> = {
  webhook: 'Webhook',
  scheduleTrigger: '定时触发',
  if: '条件判断',
  splitInBatches: '批量循环',
  set: '数据处理',
  httpRequest: 'HTTP 请求',
};

const FIELD_LABELS: Record<string, string> = {
  person_name: '人物名称',
  gesture: '动作手势',
  speech_content: '语音内容',
  tts_voice: '音色',
  screen_emoji: '屏幕表情',
  chassis_action: '底盘动作',
  hand_gestures: '机械手手势',
  yolo_gestures: '手势识别',
  emotion_labels: '情绪分类',
  arm_actions: '机械臂动作',
  face_profiles: '人脸样本',
  emotion_mode: '情绪模式',
  game_type: '游戏类型',
  schedule_time: '触发时间',
};

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onCreateWorkflow: (workflow: WorkflowDefinition) => Promise<unknown>;
  onConfirmWorkflow: () => Promise<void>;
  buildStatus: BuildStatus;
  status: ConnectionStatus;
  isBusy: boolean;
}

export function ChatInterface({
  messages,
  onSend,
  onCreateWorkflow,
  onConfirmWorkflow,
  buildStatus,
  status,
  isBusy,
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissedSummaries, setDismissedSummaries] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSubmit = () => {
    if (!input.trim()) {
      return;
    }
    onSend(input.trim());
    setInput('');
  };

  const formatNodeList = (items: Array<{ type: string }>) => {
    if (items.length === 0) {
      return '未指定';
    }
    return items.map((item) => NODE_LABELS[item.type] || item.type).join(' / ');
  };

  const formatMissingFields = (fields: string[]) => {
    if (fields.length === 0) {
      return '无';
    }
    return fields.map((field) => FIELD_LABELS[field] || field).join('、');
  };

  const fileToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

  const buildInteractionMessage = async (
    interaction: InteractionRequest,
    payload: { selected: string[]; file?: File | null }
  ) => {
    const list = payload.selected.join('、');
    switch (interaction.field) {
      case 'tts_voice':
        return `音色 ${payload.selected[0]}`;
      case 'screen_emoji':
        return `屏幕 emoji ${payload.selected[0]}`;
      case 'chassis_action':
        return `底盘 ${payload.selected[0]}`;
      case 'hand_gestures':
        return `机械手 手势执行 ${list}`;
      case 'yolo_gestures':
        return `yolov8 手势识别 ${list}`;
      case 'emotion_labels':
        return `StructBERT 情绪分类 ${list}`;
      case 'arm_actions':
        return `机械臂 动作 ${list}`;
      case 'face_profiles': {
        const profile = payload.selected[0] || interaction.options[0]?.value || '未知';
        if (payload.file) {
          try {
            const base64 = await fileToBase64(payload.file);
            const result = await uploadFaceImage(profile, payload.file.name, base64);
            const suffix = result.url ? ` ${result.url}` : result.fileName ? ` ${result.fileName}` : '';
            return `人脸识别 ${profile} 图片${suffix || '已上传'}`;
          } catch {
            return `人脸识别 ${profile} 图片上传失败`;
          }
        }
        return `人脸识别 ${profile} 图片未选择`;
      }
      default:
        return list;
    }
  };

  return (
    <section className="glass-panel relative flex h-full min-h-0 flex-col overflow-hidden rounded-3xl">
      <div className="neural-grid" />
      <div className="relative z-10 flex items-center justify-between border-b border-cyan-500/10 px-6 py-4">
        <div>
          <p className="orbitron text-[11px] uppercase tracking-[0.35em] text-cyan-400/70">Neural Intake</p>
          <p className="text-xs text-cyan-100/70">对话式需求收敛与指令生成</p>
        </div>
        <span className="mono text-[10px] uppercase text-cyan-400/60">{status.toUpperCase()}</span>
      </div>

      <div ref={listRef} className="scrollbar-none relative z-10 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {buildStatus > 0 ? (
          <BuildProgressBar status={buildStatus} />
        ) : null}
        {messages.length === 0 ? (
          <div className="space-y-4 text-sm text-cyan-100/70">
            <p className="mono text-xs uppercase tracking-[0.3em] text-cyan-400/60">Waiting for input</p>
            <p>描述你想要的机器人互动场景，Agent 会生成可执行的工作流按钮。</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`fade-up flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl border px-4 py-3 text-sm shadow-[0_0_20px_rgba(0,242,255,0.05)] ${
                  message.role === 'user'
                    ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50'
                    : message.variant === 'error'
                      ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                      : 'border-cyan-500/10 bg-black/40 text-cyan-100'
                }`}
              >
                <p>{message.text}</p>
                {message.reasoning ? (
                  <p className="mt-2 text-xs text-cyan-200/70">设计思路: {message.reasoning}</p>
                ) : null}
                {message.metadata ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase text-cyan-200/70">
                    <span className="mono rounded-full border border-cyan-400/30 px-2 py-0.5">
                      nodes {message.metadata.nodeCount}
                    </span>
                    <span className="mono rounded-full border border-cyan-400/30 px-2 py-0.5">
                      iterations {message.metadata.iterations}
                    </span>
                  </div>
                ) : null}
                {message.responseType === 'summary_ready' && message.blueprint ? (
                  <div className="mt-3 space-y-1 text-xs text-cyan-200/70">
                    <p>触发器: {formatNodeList(message.blueprint.triggers)}</p>
                    <p>逻辑: {formatNodeList(message.blueprint.logic)}</p>
                    <p>执行: {formatNodeList(message.blueprint.executors)}</p>
                    <p>缺失: {formatMissingFields(message.blueprint.missingFields)}</p>
                  </div>
                ) : null}
                {message.interaction ? (
                  <InteractionCard
                    interaction={message.interaction}
                    onSubmit={async (payload) => {
                      const messageText = await buildInteractionMessage(message.interaction!, payload);
                      onSend(messageText);
                    }}
                    disabled={isBusy}
                  />
                ) : null}
                {message.responseType === 'summary_ready' && !dismissedSummaries[message.id] ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {message.metadata?.showContinueButton !== false ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDismissedSummaries((prev) => ({
                            ...prev,
                            [message.id]: true,
                          }))
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-black/30 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-200/80 transition hover:border-cyan-200/60"
                      >
                        继续交流
                      </button>
                    ) : null}
                    {(message.metadata?.showConfirmBuildButton ??
                      (message.blueprint?.missingFields?.length === 0)) ? (
                      <button
                        type="button"
                        onClick={onConfirmWorkflow}
                        disabled={isBusy}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-500/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        确认构建
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {message.workflow ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onCreateWorkflow(message.workflow!)}
                      className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-500/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200 hover:text-cyan-50"
                    >
                      创建工作流
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => (prev === message.id ? null : message.id))}
                      className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-black/30 px-4 py-2 text-xs uppercase tracking-[0.2em] text-cyan-200/80 transition hover:border-cyan-200/60"
                    >
                      查看工作流详情
                    </button>
                  </div>
                ) : null}
                {message.workflow && expanded === message.id ? (
                  <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-cyan-500/10 bg-black/50 p-3 text-[11px] text-cyan-100/80">
                    {JSON.stringify(message.workflow, null, 2)}
                  </pre>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="relative z-10 border-t border-cyan-500/10 px-6 py-4">
        <div className="flex flex-wrap gap-2 pb-3">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setInput(prompt)}
              className="mono rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase text-cyan-200/80 transition hover:border-cyan-200/60"
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleSubmit();
              }
            }}
            placeholder="描述你的机器人场景..."
            className="flex-1 rounded-xl border border-cyan-500/20 bg-black/40 px-4 py-3 text-sm text-cyan-50 placeholder:text-cyan-200/40 focus:border-cyan-300/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isBusy}
            className="orbitron rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-5 py-3 text-xs uppercase tracking-[0.3em] text-cyan-50 transition hover:border-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? '...' : '发送'}
          </button>
        </div>
      </div>
    </section>
  );
}
