import type { HostInfo } from '@kae/shared';
import { Box, Server } from 'lucide-react';
import { bytes, duration, percent } from '../lib/format';
import { cx } from './ui';

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const level = value > 0.9 ? 'bg-error' : value > 0.75 ? 'bg-waiting' : 'bg-fg/45';
  return (
    <div className="min-w-0" title={detail}>
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
        <span className="tabular text-[13px] font-semibold text-fg">{percent(value)}</span>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={detail}
      >
        <div className={cx('h-full rounded-full transition-[width] duration-500', level)} style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
    </div>
  );
}

export function HostStrip({ host, className }: { host: HostInfo | null; className?: string }) {
  if (!host) {
    return (
      <div className={cx('rounded-lg border border-line bg-surface px-4 py-3', className)} aria-hidden>
        <div className="flex justify-between">
          <div className="h-3.5 w-28 animate-shimmer rounded bg-surface-3" />
          <div className="h-3.5 w-20 animate-shimmer rounded bg-surface-2" />
        </div>
        <div className="mt-3.5 grid grid-cols-3 gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-2.5 w-full animate-shimmer rounded bg-surface-2" />
              <div className="h-1 animate-shimmer rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  const running = host.container.state === 'running';
  const unknown = host.container.state === 'unknown';
  return (
    <section aria-label="État du serveur" className={cx('rounded-lg border border-line bg-surface px-4 py-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-[13px]">
          <Server className="size-3.5 shrink-0 text-faint" aria-hidden />
          <span className="truncate font-mono font-medium text-fg">{host.hostname}</span>
          <span className="tabular hidden shrink-0 text-faint min-[380px]:inline" title="Temps depuis le démarrage">
            · {duration(host.uptime * 1000)}
          </span>
        </p>
        <p
          className={cx('flex shrink-0 items-center gap-1.5 text-xs font-medium', running ? 'text-done' : unknown ? 'text-muted' : 'text-error')}
          title={`claude-box : ${host.container.detail}`}
        >
          <Box className="size-3.5" aria-hidden />
          <span className="font-mono">claude-box</span>
          <span aria-hidden className={cx('size-1.5 rounded-full', running ? 'bg-done' : unknown ? 'bg-idle' : 'bg-error')} />
          <span className="sr-only">{running ? 'en marche' : unknown ? 'état inconnu' : 'arrêté'} ({host.container.detail})</span>
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-5">
        <Meter label="CPU" value={host.cpu} detail={`CPU ${percent(host.cpu)} — charge ${host.load.map((l) => l.toFixed(2)).join(' / ')}`} />
        <Meter label="RAM" value={host.memTotal ? host.memUsed / host.memTotal : 0} detail={`${bytes(host.memUsed)} sur ${bytes(host.memTotal)}`} />
        <Meter label="Disque" value={host.diskTotal ? host.diskUsed / host.diskTotal : 0} detail={`${bytes(host.diskUsed)} sur ${bytes(host.diskTotal)}`} />
      </div>
    </section>
  );
}
