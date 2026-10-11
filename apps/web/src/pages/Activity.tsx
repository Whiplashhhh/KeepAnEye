import type { ActivityItem } from '@kae/shared';
import { Activity as ActivityIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { EmptyState, Skeleton, cx } from '../components/ui';
import { api } from '../lib/api';
import { clock, dayLabel } from '../lib/format';
import { useLive } from '../lib/live';
import { STATUS } from '../lib/status';

export function ActivityPage() {
  const { liveActivity } = useLive();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: ActivityItem[] }>('/api/activity?limit=200')
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  const merged = useMemo(() => {
    if (!items) return null;
    const seen = new Set(items.map((i) => i.id));
    return [...liveActivity.filter((i) => !seen.has(i.id)), ...items].sort((a, b) => b.ts - a.ts || b.id - a.id);
  }, [items, liveActivity]);

  const groups = useMemo(() => {
    const out: { day: string; items: ActivityItem[] }[] = [];
    for (const it of merged ?? []) {
      const day = dayLabel(it.ts);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(it);
      else out.push({ day, items: [it] });
    }
    return out;
  }, [merged]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-nav pt-[calc(28px+env(safe-area-inset-top))] lg:px-8 lg:pb-10 lg:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Activité</h1>
        <p className="mt-1 text-sm text-muted">Ce que tes sessions Claude ont fait, en temps réel.</p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-error/40 bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {!merged && !error && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}

      {merged && merged.length === 0 && (
        <EmptyState icon={<ActivityIcon className="size-6" />} title="Rien pour l’instant">
          Les demandes, attentes et fins de tâches de Claude apparaîtront ici dès que les hooks seront installés dans claude-box.
        </EmptyState>
      )}

      {groups.map((g) => (
        <section key={g.day} className="mb-8" aria-label={g.day}>
          <h2 className="sticky top-[env(safe-area-inset-top)] z-10 -mx-1 mb-1 bg-bg/95 px-1 py-2 text-xs font-semibold uppercase tracking-wider text-faint backdrop-blur first-letter:uppercase">
            {g.day}
          </h2>
          <ol className="relative">
            {g.items.map((it, idx) => {
              const m = STATUS[it.status];
              const Icon = m.icon;
              return (
                <li key={it.id} className="relative flex animate-rise gap-3.5 py-2.5">
                  {idx < g.items.length - 1 && <span aria-hidden className="absolute left-[15px] top-11 h-[calc(100%-32px)] w-px bg-line" />}
                  <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', m.soft, m.text)}>
                    <Icon className="size-4" aria-hidden />
                    <span className="sr-only">{m.label}</span>
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/s/${encodeURIComponent(it.session)}`}
                        className="truncate font-mono text-[13px] font-semibold text-fg hover:text-accent"
                      >
                        {it.session}
                      </Link>
                      <time className="tabular shrink-0 text-xs text-faint" dateTime={new Date(it.ts).toISOString()}>
                        {clock(it.ts)}
                      </time>
                    </div>
                    <p className={cx('mt-0.5 break-words text-sm', it.status === 'waiting' ? 'text-waiting' : 'text-muted')}>{it.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
