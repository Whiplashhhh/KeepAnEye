import type { SessionInfo } from '@kae/shared';
import { Plus, SquareTerminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLive } from '../lib/live';
import { STATUS } from '../lib/status';
import { SessionCard, SessionCardSkeleton } from './SessionCard';
import { Button, EmptyState, StatusDot } from './ui';

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Summary({ sessions }: { sessions: SessionInfo[] }) {
  const waiting = sessions.filter((s) => s.claude?.status === 'waiting').length;
  const working = sessions.filter((s) => s.claude?.status === 'working').length;
  const errors = sessions.filter((s) => s.claude?.status === 'error').length;
  const parts: { key: 'waiting' | 'working' | 'error'; n: number; label: string }[] = [];
  if (waiting) parts.push({ key: 'waiting', n: waiting, label: waiting > 1 ? "t'attendent" : "t'attend" });
  if (working) parts.push({ key: 'working', n: working, label: working > 1 ? 'travaillent' : 'travaille' });
  if (errors) parts.push({ key: 'error', n: errors, label: errors > 1 ? 'en erreur' : 'en erreur' });
  if (parts.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        {sessions.length} session{sessions.length > 1 ? 's' : ''} · rien ne t’attend
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      {parts.map((p) => (
        <span key={p.key} className={`inline-flex items-center gap-1.5 font-medium ${STATUS[p.key].text}`}>
          <StatusDot status={p.key} />
          <span className="tabular">{p.n}</span> {p.label}
        </span>
      ))}
      <span className="text-faint">
        · {sessions.length} au total
      </span>
    </p>
  );
}

export function SessionList({ selected, onNew, compact }: { selected?: string; onNew: () => void; compact?: boolean }) {
  const { sessions } = useLive();
  const now = useNow();

  if (!sessions) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Chargement des sessions">
        <SessionCardSkeleton />
        <SessionCardSkeleton />
        <SessionCardSkeleton />
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<SquareTerminal className="size-6" />}
        title="Aucune session"
        action={
          <Button variant="primary" size="lg" onClick={onNew}>
            <Plus className="size-4" aria-hidden />
            Lance ta première session
          </Button>
        }
      >
        Lance ta première : un terminal sur le serveur, ou Claude sur un de tes projets.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Sessions">
      {sessions.map((s) => (
        <li key={s.name}>
          <SessionCard session={s} selected={s.name === selected} now={now} compact={compact} />
        </li>
      ))}
    </ul>
  );
}
