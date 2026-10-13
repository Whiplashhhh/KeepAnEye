import type { DirListing } from '@kae/shared';
import { ArrowUp, Check, Eye, EyeOff, Folder, FolderPlus, Home, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Skeleton, cx } from './ui';

const tool =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent';

/** Clickable path segments: "/", "home", "me", … */
function Breadcrumb({ path, onGo }: { path: string; onGo: (p: string) => void }) {
  const parts = path.split('/').filter(Boolean);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth });
  }, [path]);
  return (
    <div ref={ref} className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap font-mono text-[13px] [scrollbar-width:none]">
      <button type="button" onClick={() => onGo('/')} className="rounded px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-fg">
        /
      </button>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        return (
          <span key={i} className="flex items-center">
            {i > 0 && <span className="text-faint">/</span>}
            <button
              type="button"
              onClick={() => onGo(`/${parts.slice(0, i + 1).join('/')}`)}
              aria-current={last ? 'location' : undefined}
              className={cx('rounded px-1 py-0.5 hover:bg-surface-2', last ? 'font-semibold text-fg' : 'text-muted hover:text-fg')}
            >
              {p}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/**
 * File-explorer style folder browser on the host. The folder being shown is the selection;
 * `onChange` fires each time the user navigates.
 */
export function FolderPicker({
  value,
  onChange,
  onHome,
}: {
  value: string;
  onChange: (path: string) => void;
  /** Receives the host's home folder once known. */
  onHome?: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        const l = await api<DirListing>(path ? `/api/fs?path=${encodeURIComponent(path)}` : '/api/fs');
        setListing(l);
        if (!path) {
          setHome(l.path);
          onHome?.(l.path);
        }
        onChange(l.path);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [onChange, onHome],
  );

  // Start where the user left off, else in the home folder.
  useEffect(() => {
    if (value) {
      void api<DirListing>('/api/fs')
        .then((l) => {
          setHome(l.path);
          onHome?.(l.path);
        })
        .catch(() => undefined);
    }
    void load(value || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (path: string) => {
    setCreating(false);
    void load(path);
  };

  const create = async () => {
    if (!listing || !newName.trim()) return;
    setBusy(true);
    setCreateError(null);
    try {
      const { path } = await api<{ path: string }>('/api/fs/mkdir', { method: 'POST', body: { parent: listing.path, name: newName } });
      setCreating(false);
      setNewName('');
      await load(path);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter must not submit the surrounding "new session" form.
    if (e.key === 'Enter') {
      e.preventDefault();
      void create();
    }
  };

  const entries = (listing?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const hiddenCount = (listing?.entries ?? []).filter((e) => e.hidden).length;
  const join = (name: string) => (listing!.path === '/' ? `/${name}` : `${listing!.path}/${name}`);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-1 border-b border-line px-1.5 py-1">
        <button type="button" className={tool} onClick={() => listing?.parent && go(listing.parent)} disabled={!listing?.parent} aria-label="Dossier parent" title="Dossier parent">
          <ArrowUp className="size-4" />
        </button>
        <button type="button" className={tool} onClick={() => home && go(home)} disabled={!home} aria-label="Dossier personnel" title="Dossier personnel">
          <Home className="size-4" />
        </button>
        {listing ? <Breadcrumb path={listing.path} onGo={go} /> : <span className="flex-1" />}
        <button
          type="button"
          className={tool}
          onClick={() => setShowHidden((v) => !v)}
          aria-pressed={showHidden}
          aria-label={showHidden ? 'Masquer les dossiers cachés' : 'Afficher les dossiers cachés'}
          title={showHidden ? 'Masquer les dossiers cachés' : `Afficher les dossiers cachés${hiddenCount ? ` (${hiddenCount})` : ''}`}
        >
          {showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
        <button
          type="button"
          className={tool}
          onClick={() => {
            setCreating(true);
            setCreateError(null);
          }}
          disabled={!listing}
          aria-label="Nouveau dossier"
          title="Nouveau dossier"
        >
          <FolderPlus className="size-4" />
        </button>
      </div>

      {creating && (
        <div className="border-b border-line bg-surface-2/60 px-2 py-2">
          <div className="flex items-center gap-1.5">
            <FolderPlus className="ml-1 size-4 shrink-0 text-accent" aria-hidden />
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={onNameKey}
              placeholder="Nom du nouveau dossier"
              aria-label="Nom du nouveau dossier"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={255}
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 font-mono text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
            <button type="button" className={tool} onClick={() => void create()} disabled={busy || !newName.trim()} aria-label="Créer le dossier" title="Créer">
              <Check className="size-4" />
            </button>
            <button type="button" className={tool} onClick={() => setCreating(false)} aria-label="Annuler" title="Annuler">
              <X className="size-4" />
            </button>
          </div>
          {createError && <p className="mt-1.5 px-1 text-xs text-error">{createError}</p>}
        </div>
      )}

      <div className={cx('h-60 overflow-y-auto p-1 transition-opacity', loading && listing && 'opacity-60')} aria-busy={loading}>
        {error ? (
          <p role="alert" className="px-3 py-3 text-sm text-error">
            {error}
          </p>
        ) : !listing ? (
          <div className="space-y-1 p-1">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : entries.length === 0 ? (
          <p className="px-3 py-3 text-sm text-faint">Aucun sous-dossier{hiddenCount && !showHidden ? ' visible' : ''}.</p>
        ) : (
          <ul>
            {entries.map((e) => (
              <li key={e.name}>
                <button
                  type="button"
                  onClick={() => go(join(e.name))}
                  className={cx(
                    'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left font-mono text-[13px] hover:bg-surface-2',
                    e.hidden ? 'text-faint' : 'text-fg',
                  )}
                >
                  <Folder className="size-4 shrink-0 text-accent" aria-hidden />
                  <span className="truncate">{e.name}</span>
                </button>
              </li>
            ))}
            {listing.truncated && <li className="px-2.5 py-2 text-xs text-faint">Liste tronquée (trop de dossiers).</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
