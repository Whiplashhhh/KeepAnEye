import type { SessionInfo } from '@kae/shared';
import { Bot, LayoutGrid, Maximize2, Plus, Server, SquareTerminal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Terminal } from '../components/Terminal';
import { Button, StatusDot, cx } from '../components/ui';
import { useLive } from '../lib/live';
import { useIsDesktop } from '../lib/media';

/** How many terminals fit on one screen and stay readable. */
export const GRID_MAX = 4;
const LAST_KEY = 'kae.grid';

export function gridHref(names: string[]): string {
  return `/grid/${names.map(encodeURIComponent).join(',')}`;
}

/** The grid the user last had open, so it can be reopened from the palette. */
export function lastGridHref(fallback?: string): string {
  try {
    const saved = localStorage.getItem(LAST_KEY);
    if (saved) return `/grid/${saved}`;
  } catch {
    // storage blocked
  }
  return gridHref(fallback ? [fallback] : []);
}

export function parseGrid(raw: string | undefined): string[] {
  const names = (raw ?? '')
    .split(',')
    .map((n) => decodeURIComponent(n.trim()))
    .filter(Boolean);
  return [...new Set(names)].slice(0, GRID_MAX);
}

/** Desktop only: several sessions side by side. On a phone it falls back to the first one. */
export function GridView({ names, onNew }: { names: string[]; onNew: () => void }) {
  const { sessions } = useLive();
  const [, navigate] = useLocation();
  const desktop = useIsDesktop();
  const [adding, setAdding] = useState(false);

  // Drop sessions that no longer exist (closed from elsewhere, renamed).
  const panes = useMemo(
    () => (sessions ? names.filter((n) => sessions.some((s) => s.name === n)) : names),
    [names, sessions],
  );
  const key = panes.join(',');
  useEffect(() => {
    if (key !== names.join(',')) navigate(gridHref(panes), { replace: true });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      if (key) localStorage.setItem(LAST_KEY, panes.map(encodeURIComponent).join(','));
    } catch {
      // storage blocked
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!desktop) navigate(panes[0] ? `/s/${encodeURIComponent(panes[0])}` : '/', { replace: true });
  }, [desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!desktop) return null;

  const set = (next: string[]) => navigate(gridHref(next));
  const showAdd = panes.length < GRID_MAX && (adding || panes.length < 2);
  const cells = panes.length + (showAdd ? 1 : 0);

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-elevated px-5">
        <LayoutGrid className="size-4 text-muted" aria-hidden />
        <h1 className="text-[15px] font-semibold text-fg">Grille</h1>
        <span className="tabular text-xs text-faint">
          {panes.length}/{GRID_MAX} terminaux
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={() => setAdding(true)} disabled={showAdd || panes.length >= GRID_MAX}>
            <Plus className="size-4" aria-hidden />
            Ajouter
          </Button>
          <Button variant="ghost" onClick={() => navigate(panes[0] ? `/s/${encodeURIComponent(panes[0])}` : '/')}>
            <X className="size-4" aria-hidden />
            Quitter la grille
          </Button>
        </div>
      </header>

      <div
        className={cx(
          'grid min-h-0 flex-1 gap-px bg-line',
          cells <= 1 ? 'grid-cols-1' : 'grid-cols-2',
          cells >= 3 && 'grid-rows-2',
          // Three panes: the first takes the whole left column.
          cells === 3 && '[&>*:first-child]:row-span-2',
        )}
      >
        {panes.map((n) => (
          <Pane
            key={n}
            name={n}
            session={sessions?.find((s) => s.name === n)}
            onRemove={() => set(panes.filter((p) => p !== n))}
          />
        ))}
        {showAdd && (
          <AddSlot
            exclude={panes}
            onPick={(n) => {
              setAdding(false);
              set([...panes, n]);
            }}
            onCancel={panes.length >= 2 ? () => setAdding(false) : undefined}
            onNew={onNew}
          />
        )}
      </div>
    </div>
  );
}

function Pane({ name, session, onRemove }: { name: string; session?: SessionInfo; onRemove: () => void }) {
  const status = session?.claude?.status;
  const sub = session?.kind === 'claude' ? (session.project ?? 'Claude') : session?.sshHost ? `SSH · ${session.sshHost}` : 'Terminal';
  return (
    <section
      aria-label={`Session ${name}`}
      className="group/pane flex min-h-0 min-w-0 flex-col bg-bg focus-within:[&>header]:bg-surface-2"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-elevated pl-3 pr-1 transition-colors">
        {status && <StatusDot status={status} />}
        <span className="truncate font-mono text-[13px] font-semibold text-fg">{name}</span>
        <span className="truncate text-xs text-faint">{sub}</span>
        <div className="ml-auto flex shrink-0 items-center">
          <Link
            href={`/s/${encodeURIComponent(name)}`}
            aria-label={`Ouvrir ${name} en plein écran`}
            title="Plein écran"
            className="inline-flex size-8 items-center justify-center rounded-md text-faint hover:bg-surface-3 hover:text-fg"
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Retirer ${name} de la grille`}
            title="Retirer de la grille (la session continue)"
            className="inline-flex size-8 items-center justify-center rounded-md text-faint hover:bg-surface-3 hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </header>
      {session?.claude?.lastMessage && (status === 'waiting' || status === 'error') && (
        <p
          role="status"
          className={cx(
            'shrink-0 truncate border-b px-3 py-1 text-xs font-medium',
            status === 'waiting' ? 'border-waiting/30 bg-waiting-soft text-waiting' : 'border-error/30 bg-error-soft text-error',
          )}
        >
          {session.claude.lastMessage}
        </p>
      )}
      <Terminal session={name} className="relative flex-1" />
    </section>
  );
}

function AddSlot({
  exclude,
  onPick,
  onCancel,
  onNew,
}: {
  exclude: string[];
  onPick: (name: string) => void;
  onCancel?: () => void;
  onNew: () => void;
}) {
  const { sessions } = useLive();
  const others = (sessions ?? []).filter((s) => !exclude.includes(s.name));
  return (
    <section aria-label="Ajouter un terminal" className="flex min-h-0 min-w-0 flex-col bg-elevated">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1">
        <Plus className="size-4 text-muted" aria-hidden />
        <span className="text-[13px] font-semibold text-fg">Ajouter un terminal</span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Annuler"
            className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-faint hover:bg-surface-3 hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {others.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm text-muted">Aucune autre session ouverte.</p>
            <Button onClick={onNew}>
              <Plus className="size-4" aria-hidden />
              Nouvelle session
            </Button>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {others.map((s) => {
              const Icon = s.kind === 'claude' ? Bot : s.sshHost ? Server : SquareTerminal;
              return (
                <li key={s.name}>
                  <button
                    type="button"
                    onClick={() => onPick(s.name)}
                    className="flex w-full items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-left hover:border-line-strong hover:bg-surface-2"
                  >
                    {s.claude ? <StatusDot status={s.claude.status} /> : <Icon className="size-3.5 shrink-0 text-faint" aria-hidden />}
                    <span className="truncate font-mono text-[13px] font-semibold text-fg">{s.name}</span>
                    <span className="truncate text-xs text-faint">
                      {s.kind === 'claude' ? (s.project ?? 'Claude') : (s.sshHost ?? 'Terminal')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
