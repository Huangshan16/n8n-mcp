const LOG_LINES = [
  '[boot] agent kernel warmup',
  '[link] websocket handshake ready',
  '[cache] workflow architect primed',
  '[watch] waiting for new intents',
];

export function SystemLogPlaceholder() {
  return (
    <section className="glass-panel flex h-full flex-col overflow-hidden rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="orbitron text-[11px] uppercase tracking-[0.35em] text-cyan-400/70">System Log</p>
          <p className="text-xs text-cyan-100/70">运行状态与事件占位</p>
        </div>
        <span className="mono text-[10px] text-cyan-400/60">STREAM</span>
      </div>

      <div className="mt-6 flex-1 space-y-3 rounded-2xl border border-cyan-500/10 bg-black/40 p-4">
        {LOG_LINES.map((line) => (
          <div key={line} className="mono text-[11px] text-cyan-200/70">
            {line}
          </div>
        ))}
      </div>

      <div className="mt-4 text-xs text-cyan-200/50">实时日志功能将在后续版本开放。</div>
    </section>
  );
}
