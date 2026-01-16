import { useMemo, useState } from 'react';
import type { InteractionRequest } from '../lib/agentApi';

interface InteractionCardProps {
  interaction: InteractionRequest;
  onSubmit: (payload: { selected: string[]; file?: File | null }) => void | Promise<void>;
  disabled?: boolean;
}

const FIELD_LABELS: Record<InteractionRequest['field'], string> = {
  tts_voice: '音色选择',
  screen_emoji: '屏幕表情',
  chassis_action: '底盘动作',
  hand_gestures: '机械手手势',
  yolo_gestures: '手势识别',
  emotion_labels: '情绪分类',
  arm_actions: '机械臂动作',
  face_profiles: '人脸样本',
};

export function InteractionCard({ interaction, onSubmit, disabled }: InteractionCardProps) {
  const initialSelected = useMemo(() => {
    if (Array.isArray(interaction.selected)) {
      return interaction.selected;
    }
    if (interaction.selected) {
      return [interaction.selected];
    }
    return [];
  }, [interaction.selected]);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [file, setFile] = useState<File | null>(null);

  const isMulti = interaction.mode === 'multi';
  const isImage = interaction.mode === 'image';
  const minSelections = interaction.minSelections ?? 1;
  const maxSelections = interaction.maxSelections ?? (isMulti ? interaction.options.length : 1);
  const selectionCount = selected.length;

  const toggleOption = (value: string) => {
    if (isMulti) {
      setSelected((prev) => {
        if (prev.includes(value)) {
          return prev.filter((item) => item !== value);
        }
        if (prev.length >= maxSelections) {
          return prev;
        }
        return [...prev, value];
      });
      return;
    }
    setSelected([value]);
  };

  const canSubmit = selectionCount >= minSelections && (!isImage || Boolean(file));

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    await onSubmit({ selected, file });
  };

  return (
    <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4 text-xs text-cyan-100/80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.3em] text-cyan-400/60">
            {FIELD_LABELS[interaction.field]}
          </p>
          <p className="mt-1 text-sm text-cyan-100">{interaction.title}</p>
          {interaction.description ? (
            <p className="mt-1 text-xs text-cyan-200/70">{interaction.description}</p>
          ) : null}
        </div>
        <div className="rounded-full border border-cyan-400/30 px-2 py-1 text-[10px] uppercase text-cyan-200/70">
          {interaction.mode === 'multi' ? '多选' : interaction.mode === 'image' ? '上传' : '单选'}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {interaction.options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleOption(option.value)}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition ${
                active
                  ? 'border-cyan-300/70 bg-cyan-400/20 text-cyan-50'
                  : 'border-cyan-500/20 bg-black/20 text-cyan-200/70 hover:border-cyan-300/50'
              }`}
            >
              <span>{option.label}</span>
              <span
                className={`h-2 w-2 rounded-full ${
                  active ? 'bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-slate-600'
                }`}
              />
            </button>
          );
        })}
      </div>

      {isImage ? (
        <div className="mt-4 rounded-xl border border-dashed border-cyan-400/30 bg-black/20 p-3">
          <p className="text-[11px] text-cyan-200/70">
            {interaction.uploadHint ?? '上传清晰的人脸照片'}
          </p>
          <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg border border-cyan-500/20 bg-black/40 px-3 py-2 text-[11px] text-cyan-100/80">
            <span>{file ? file.name : '选择图片文件'}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
              }}
            />
          </label>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between text-[10px] text-cyan-200/60">
        <span>
          已选 {selectionCount}/{maxSelections}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !canSubmit}
          className="rounded-full border border-cyan-400/40 bg-cyan-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-cyan-50 transition hover:border-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          确认
        </button>
      </div>
    </div>
  );
}
