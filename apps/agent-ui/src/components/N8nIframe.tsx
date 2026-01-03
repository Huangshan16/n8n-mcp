interface N8nIframeProps {
  refreshToken: number;
}

const IFRAME_URL = import.meta.env.VITE_N8N_IFRAME_URL || 'http://localhost:5678/home/workflows';

export function N8nIframe({ refreshToken }: N8nIframeProps) {
  return (
    <section className="glass-panel flex h-full flex-col overflow-hidden rounded-3xl">
      <div className="flex items-center justify-between border-b border-cyan-500/10 px-6 py-4">
        <div>
          <p className="orbitron text-[11px] uppercase tracking-[0.35em] text-cyan-400/70">n8n Control</p>
          <p className="text-xs text-cyan-100/70">实时查看工作流拓扑</p>
        </div>
        <span className="mono text-[10px] text-cyan-400/60">LOCALHOST:5678</span>
      </div>
      <div className="relative flex-1 bg-black/40">
        <iframe
          key={refreshToken}
          src={IFRAME_URL}
          title="n8n"
          className="h-full w-full border-0"
        />
        <div className="pointer-events-none absolute inset-0 border border-cyan-500/10" />
      </div>
    </section>
  );
}
