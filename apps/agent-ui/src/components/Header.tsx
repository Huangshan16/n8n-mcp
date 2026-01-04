import type { ConnectionStatus } from '../hooks/useAgentChat';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'LINKING',
  open: 'SYSTEM_ONLINE',
  closed: 'SYSTEM_OFFLINE',
  error: 'SIGNAL_ERROR',
};

export function Header({ status, onRestart }: { status: ConnectionStatus; onRestart: () => void }) {
  const label = STATUS_LABELS[status];
  const dotColor =
    status === 'open' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-cyan-400' : 'bg-rose-400';

  return (
    <header className="glass-panel flex h-14 items-center justify-between rounded-2xl px-6">
      <div className="flex items-center gap-3">
        <div className="orbitron flex h-9 w-9 items-center justify-center rounded-md bg-cyan-400 text-xs font-bold text-black shadow-[0_0_15px_rgba(0,242,255,0.5)]">
          M
        </div>
        <div>
          <div className="orbitron text-xs tracking-[0.4em] text-cyan-200">MAGI CORE</div>
          <div className="mono text-[10px] uppercase text-cyan-500/70">Agent Console v4.1</div>
        </div>
      </div>

      <div className="mono flex items-center gap-4 text-[10px] uppercase text-cyan-200/70">
        <span className="hidden md:inline">BUS_SPEED: 4.2GB/S</span>
        <button
          type="button"
          onClick={onRestart}
          className="rounded-full border border-cyan-400/30 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-cyan-200/80 transition hover:border-cyan-200/70 hover:text-cyan-100"
        >
          重新开始
        </button>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dotColor} pulse-dot`}></span>
          {label}
        </div>
      </div>
    </header>
  );
}
