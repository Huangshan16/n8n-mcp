interface BuildProgressBarProps {
  status: number;
}

const STEPS = [
  { id: 1, label: '生成JSON' },
  { id: 2, label: '校验工作流' },
  { id: 3, label: '部署到n8n' },
];

export function BuildProgressBar({ status }: BuildProgressBarProps) {
  return (
    <div className="rounded-2xl border border-cyan-500/10 bg-black/40 px-4 py-3 text-xs text-cyan-100/70">
      <div className="flex items-center justify-between gap-3">
        {STEPS.map((step, index) => {
          const active = status >= step.id;
          return (
            <div key={step.id} className="flex flex-1 items-center gap-3">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  active ? 'border-cyan-300 bg-cyan-500/20 text-cyan-100' : 'border-cyan-500/20 text-cyan-200/50'
                }`}
              >
                {step.id}
              </div>
              <span className={active ? 'text-cyan-100' : 'text-cyan-200/40'}>{step.label}</span>
              {index < STEPS.length - 1 ? (
                <div className={`mx-2 h-px flex-1 ${active ? 'bg-cyan-400/40' : 'bg-cyan-500/10'}`} />
              ) : null}
            </div>
          );
        })}
      </div>
      {status < 3 ? (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-cyan-300/60">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400/70" />
          正在构建，请稍候…
        </div>
      ) : null}
    </div>
  );
}
