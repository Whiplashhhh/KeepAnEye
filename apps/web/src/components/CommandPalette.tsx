import * as Dialog from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react';
import { Activity, Bot, Keyboard, LogOut, Moon, Plus, Search, Settings, SquareTerminal, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useLive } from '../lib/live';
import { STATUS } from '../lib/status';
import { useTheme } from '../lib/theme';
import { Kbd, cx } from './ui';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  iconClass?: string;
  group: string;
  run: () => void;
}

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function CommandPalette({
  open,
  onOpenChange,
  onNewSession,
  onShortcuts,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onNewSession: () => void;
  onShortcuts: () => void;
  onLogout: () => void;
}) {
  const { sessions } = useLive();
  const { resolved, toggle } = useTheme();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const close = (fn: () => void) => () => {
      onOpenChange(false);
      fn();
    };
    const list: Command[] = (sessions ?? []).map((s) => ({
      id: `s:${s.name}`,
      label: s.name,
      hint: s.claude ? STATUS[s.claude.status].label : (s.project ?? s.sshHost ?? 'Terminal'),
      icon: s.kind === 'claude' ? Bot : SquareTerminal,
      iconClass: s.claude ? STATUS[s.claude.status].text : undefined,
      group: 'Sessions',
      run: close(() => navigate(`/s/${encodeURIComponent(s.name)}`)),
    }));
    list.push(
      { id: 'new', label: 'Nouvelle session', icon: Plus, group: 'Actions', run: close(onNewSession), hint: 'N' },
      { id: 'activity', label: 'Voir l’activité', icon: Activity, group: 'Actions', run: close(() => navigate('/activity')) },
      { id: 'settings', label: 'Réglages', icon: Settings, group: 'Actions', run: close(() => navigate('/settings')) },
      {
        id: 'theme',
        label: resolved === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre',
        icon: resolved === 'dark' ? Sun : Moon,
        group: 'Actions',
        run: close(toggle),
      },
      { id: 'keys', label: 'Raccourcis clavier', icon: Keyboard, group: 'Actions', run: close(onShortcuts), hint: '?' },
      { id: 'logout', label: 'Se déconnecter', icon: LogOut, group: 'Actions', run: close(onLogout) },
    );
    return list;
  }, [sessions, resolved, toggle, navigate, onNewSession, onShortcuts, onLogout, onOpenChange]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return commands;
    return commands.filter((c) => normalize(`${c.label} ${c.hint ?? ''}`).includes(q));
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 animate-pop overflow-hidden rounded-xl border border-line-strong bg-elevated shadow-pop outline-none"
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">Palette de commandes</Dialog.Title>
          <Dialog.Description className="sr-only">Cherche une session ou une action, puis Entrée.</Dialog.Description>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ouvrir une session, créer, changer de thème…"
              className="h-13 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint focus-visible:outline-none"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={filtered[active] ? `cmd-${filtered[active].id}` : undefined}
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {filtered.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Aucun résultat pour « {query} »</li>}
            {filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              const Icon = c.icon;
              return (
                <li key={c.id} role="presentation">
                  {header && <div className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{header}</div>}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={c.run}
                    className={cx(
                      'flex h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm',
                      i === active ? 'bg-surface-3 text-fg' : 'text-muted',
                    )}
                  >
                    <Icon className={cx('size-4 shrink-0', c.iconClass ?? 'text-faint')} aria-hidden />
                    <span className={cx('flex-1 truncate', c.group === 'Sessions' && 'font-mono')}>{c.label}</span>
                    {c.hint && <span className="text-xs text-faint">{c.hint}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
