import type { Timeline as TimelineData, TimelineItem } from '@kae/shared';
import { CircleAlert, FileCode2, ScrollText, Sparkles, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { clock } from '../lib/format';
import { EmptyState, Skeleton, cx } from './ui';

function Item({ item }: { item: TimelineItem }) {
  const time = item.ts ? <time className="tabular text-[11px] text-faint">{clock(item.ts)}</time> : null;
  switch (item.kind) {
    case 'user':
      return (
        <li className="flex animate-rise justify-end">
          <div className="max-w-[85%] rounded-lg rounded-br-sm border border-accent/25 bg-accent-soft px-3.5 py-2.5">
            <div className="mb-1 flex items-center justify-end gap-2 text-[11px] font-medium text-muted">
              {time}
              <span>Toi</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-fg">{item.text}</p>
          </div>
        </li>
      );
    case 'assistant':
      return (
        <li className="flex animate-rise gap-3">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-accent">
            <Sparkles className="size-3.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted">
              <span>Claude</span>
              {time}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{item.text}</p>
          </div>
        </li>
      );
    case 'tool':
      return (
        <li className="flex animate-rise items-center gap-3 pl-1">
          <div className="flex size-5 shrink-0 items-center justify-center text-faint">
            <Wrench className="size-3.5" aria-hidden />
          </div>
          <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
            <span className="font-semibold text-fg/80">{item.tool}</span>
            {item.summary && <span className="text-faint"> · {item.summary}</span>}
          </p>
          {time}
        </li>
      );
    case 'result':
      return (
        <li className="flex animate-rise items-start gap-3 pl-1">
          <CircleAlert className={cx('mt-0.5 size-4 shrink-0', item.isError ? 'text-error' : 'text-faint')} aria-hidden />
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs text-error/90">{item.text}</p>
        </li>
      );
  }
}

export function Timeline({ session }: { session: string }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const d = await api<TimelineData>(`/api/sessions/${encodeURIComponent(session)}/timeline`);
        if (!stop) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void load();
    const t = window.setInterval(load, 4000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [session]);

  useEffect(() => {
    if (data && data.items.length !== lastCount.current) {
      lastCount.current = data.items.length;
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [data]);

  if (!data && !error) {
    return (
      <div className="space-y-5 p-5" aria-busy="true" aria-label="Chargement de la timeline">
        <Skeleton className="ml-auto h-14 w-2/3" />
        <Skeleton className="h-20 w-5/6" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
      </div>
    );
  }
  if (error && !data) {
    return (
      <EmptyState icon={<CircleAlert className="size-6" />} title="Timeline indisponible">
        {error}
      </EmptyState>
    );
  }
  if (!data!.available || data!.items.length === 0) {
    return (
      <EmptyState icon={<ScrollText className="size-6" />} title="Pas encore de timeline">
        {data!.reason ??
          'Elle apparaîtra dès que Claude aura reçu une demande. Vérifie que les transcripts sont montés sur l’hôte (voir README).'}
      </EmptyState>
    );
  }
  const d = data!;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
      {d.filesTouched.length > 0 && (
        <details className="mb-5 rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-fg">
            <FileCode2 className="size-4 text-muted" aria-hidden />
            Fichiers modifiés
            <span className="tabular ml-auto rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">{d.filesTouched.length}</span>
          </summary>
          <ul className="space-y-1 border-t border-line px-4 py-3">
            {d.filesTouched.map((f) => (
              <li key={f} className="truncate font-mono text-xs text-muted" title={f}>
                {f}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ol className="space-y-4" aria-label="Timeline de la session Claude">
        {d.items.map((it, i) => (
          <Item key={i} item={it} />
        ))}
      </ol>
      <div ref={bottomRef} />
      {d.lastAssistant && (
        <p className="sr-only" aria-live="polite">
          Dernier message de Claude : {d.lastAssistant}
        </p>
      )}
    </div>
  );
}
