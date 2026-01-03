export function HardwareTwinPlaceholder() {
  return (
    <section className="glass-panel relative flex h-full flex-col overflow-hidden rounded-3xl p-6">
      <div className="neural-grid" />
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <p className="orbitron text-[11px] uppercase tracking-[0.35em] text-cyan-400/70">Hardware Twin</p>
          <p className="text-xs text-cyan-100/70">数字孪生可视化占位</p>
        </div>
        <span className="mono text-[10px] text-cyan-400/60">COMING SOON</span>
      </div>

      <div className="relative z-10 mt-6 flex flex-1 items-center justify-center">
        <div className="flex h-40 w-40 items-center justify-center rounded-[32px] border border-cyan-500/20 bg-black/40">
          <div className="pulse-dot h-3 w-3 rounded-full bg-cyan-400" />
        </div>
      </div>
      <div className="relative z-10 mt-4 text-xs text-cyan-200/60">
        机械手 · 摄像头 · 喇叭 · 底盘 · 屏幕
      </div>
    </section>
  );
}
