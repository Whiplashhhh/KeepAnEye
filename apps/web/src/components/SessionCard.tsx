import type { SessionInfo } from '@kae/shared';
import { Bot, Server, SquareTerminal, Users } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'wouter';
import { timeAgo } from '../lib/format';
import { StatusBadge, cx } from './ui';

export const SessionCard = memo(function SessionCard({
  session,
  selected,
  now,
  compact,
}: {
  session: SessionInfo;
  selected?: boolean;
  now: number;
  compact?: boolean;
}) {
  const status = session.claude?.status;
  const waiting = status === 'waiting';
  const preview = session.preview.slice(compact ? -2 : -3);
  const KindIcon = session.kind === 'claude' ? Bot : session.sshHost ? Server : SquareTerminal;

  return (
    <Link
      href={`/s/${encodeURIComponent(session.name)}`}
      aria-current={selected ? 'page' : undefined}
      data-testid={`session-${session.name}`}
      className={cx(
        'group relative block animate-rise rounded-lg border bg-surface p-4 transition-[border-color,background,box-shadow] duration-200',
        'hover:border-line-strong focus-visible:outline-offset-0',
        waiting ? 'border-waiting/45 shadow-[inset_3px_0_0_var(--waiting)]' : 'border-line',
        status === 'error' && 'border-error/40 shadow-[inset_3px_0_0_var(--error)]',
        selected && 'bg-surface-2 ring-1 ring-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-[15px] font-semibold leading-6 text-fg">{session.name}</h3>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
            <KindIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">{session.kind === 'claude' ? 'Session Claude' : session.sshHost ? 'Terminal SSH' : 'Terminal'}</span>
            <span className="truncate">
              {session.kind === 'claude' ? (session.project ?? 'Claude') : (session.sshHost ?? 'Terminal')}
            </span>
            <span className="text-faint" aria-hidden>
              ·
            </span>
            <span className="tabular shrink-0 text-faint" title={new Date(session.activityAt).toLocaleString('fr-FR')}>
              {timeAgo(session.activityAt, now)}
            </span>
            {session.attached > 0 && (
              <span className="ml-0.5 inline-flex shrink-0 items-center gap-1 text-faint" title={`${session.attached} client(s) attaché(s)`}>
                <Users className="size-3.5" aria-hidden />
                <span className="tabular">{session.attached}</span>
                <span className="sr-only">appareil(s) connecté(s)</span>
              </span>
            )}
          </p>
        </div>
        {status && <StatusBadge status={status} size="sm" />}
      </div>

      {session.claude?.lastMessage && (status === 'waiting' || status === 'error') && (
        <p className={cx('mt-2.5 line-clamp-2 text-[13px] font-medium leading-5', waiting ? 'text-waiting' : 'text-error')}>
          {session.claude.lastMessage}
        </p>
      )}

      {preview.length > 0 && (
        <pre
          aria-label="Aperçu des dernières lignes"
          className="mt-3 overflow-hidden rounded-md bg-surface-2/70 px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-faint group-aria-[current=page]:bg-surface-3/60"
        >
          {preview.map((l, i) => (
            <span key={i} className="block truncate">
              {l || ' '}
            </span>
          ))}
        </pre>
      )}
    </Link>
  );
});

export function SessionCardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-surface p-4" aria-hidden>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-4 w-32 animate-shimmer rounded bg-surface-3" />
          <div className="h-3 w-44 animate-shimmer rounded bg-surface-2" />
        </div>
        <div className="h-6 w-20 animate-shimmer rounded-full bg-surface-2" />
      </div>
      <div className="mt-3 h-12 animate-shimmer rounded-md bg-surface-2" />
    </div>
  );
}
