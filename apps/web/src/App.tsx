import { Command, Plus, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Brand } from './components/Brand';
import { CommandPalette } from './components/CommandPalette';
import { HostStrip } from './components/HostStrip';
import { BottomNav, SideNav } from './components/Nav';
import { NewSessionSheet } from './components/NewSession';
import { SessionList, Summary } from './components/SessionList';
import { ShortcutsDialog } from './components/Shortcuts';
import { Button, Kbd, Skeleton } from './components/ui';
import { api, onUnauthorized } from './lib/api';
import { updateAttention } from './lib/favicon';
import { LiveProvider, useLive } from './lib/live';
import { waitingCount } from './lib/status';
import { useTheme } from './lib/theme';
import { ActivityPage } from './pages/Activity';
import { AuditPage } from './pages/Audit';
import { LoginPage } from './pages/Login';
import { SessionView } from './pages/SessionView';
import { SettingsPage } from './pages/Settings';

type AuthState = { status: 'loading' } | { status: 'in' } | { status: 'out'; stage: 'password' | 'second-factor' | 'uninitialized' };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  const check = useCallback(async () => {
    try {
      const me = await api<{ authenticated: boolean; stage: 'password' | 'second-factor' | 'uninitialized' | 'done' }>('/api/auth/me');
      setAuth(me.authenticated ? { status: 'in' } : { status: 'out', stage: me.stage === 'done' ? 'password' : me.stage });
    } catch {
      setAuth({ status: 'out', stage: 'password' });
    }
  }, []);

  useEffect(() => {
    void check();
    return onUnauthorized(() => setAuth({ status: 'out', stage: 'password' }));
  }, [check]);

  if (auth.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Skeleton className="size-12 rounded-xl" />
      </div>
    );
  }
  if (auth.status === 'out') return <LoginPage initialStage={auth.stage} onDone={() => setAuth({ status: 'in' })} />;
  return (
    <LiveProvider onExpired={() => setAuth({ status: 'out', stage: 'password' })}>
      <Shell onLoggedOut={() => setAuth({ status: 'out', stage: 'password' })} />
    </LiveProvider>
  );
}

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest('.xterm')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { sessions, host, link } = useLive();
  const { toggle } = useTheme();
  const [location, navigate] = useLocation();
  const [newOpen, setNewOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const gPressed = useRef(0);

  const waiting = sessions ? waitingCount(sessions) : 0;
  const selected = location.startsWith('/s/') ? decodeURIComponent(location.slice(3)) : undefined;

  useEffect(() => updateAttention(waiting), [waiting]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    onLoggedOut();
  }, [onLoggedOut]);

  const openNew = useCallback(() => setNewOpen(true), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyK' && (e.shiftKey || !isTyping(document.activeElement))) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (mod || e.altKey || isTyping(document.activeElement) || newOpen || paletteOpen || helpOpen) return;
      const list = sessions ?? [];
      const idx = selected ? list.findIndex((s) => s.name === selected) : -1;
      if (Date.now() - gPressed.current < 800) {
        gPressed.current = 0;
        if (e.key === 'a') navigate('/activity');
        else if (e.key === 'r') navigate('/settings');
        else if (e.key === 's') navigate('/');
        return;
      }
      switch (e.key) {
        case '?':
          setHelpOpen(true);
          break;
        case 'n':
          e.preventDefault();
          setNewOpen(true);
          break;
        case 'j':
          if (list.length) navigate(`/s/${encodeURIComponent(list[Math.min(list.length - 1, idx + 1)]!.name)}`);
          break;
        case 'k':
          if (list.length) navigate(`/s/${encodeURIComponent(list[Math.max(0, idx - 1)]!.name)}`);
          break;
        case 't':
          toggle();
          break;
        case 'g':
          gPressed.current = Date.now();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessions, selected, navigate, toggle, newOpen, paletteOpen, helpOpen]);

  const inSession = !!selected;

  return (
    <div className="h-full lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden h-full w-[400px] shrink-0 flex-col border-r border-line bg-elevated lg:flex" aria-label="Sessions">
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line px-5">
          <Brand />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-faint hover:border-line-strong hover:text-muted xl:inline-flex"
              aria-label="Palette de commandes (Ctrl+K)"
            >
              <Command className="size-3.5" aria-hidden />
              <Kbd>Ctrl K</Kbd>
            </button>
            <Button className="h-9 px-3" onClick={openNew} aria-label="Nouvelle session (N)">
              <Plus className="size-4" aria-hidden />
              Nouvelle
            </Button>
          </div>
        </div>
        <div className="space-y-3 px-4 pb-3 pt-4">
          <HostStrip host={host} />
          {sessions && sessions.length > 0 && (
            <div className="px-1">
              <Summary sessions={sessions} />
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <SessionList selected={selected} onNew={openNew} compact />
        </div>
        <div className="shrink-0 border-t border-line p-2">
          <SideNav />
        </div>
      </aside>

      {/* Main area */}
      {/* The main area scrolls, never the document: in the installed iOS PWA a scrolling document
          lifted the fixed bottom nav off the screen edge. */}
      <main className="h-full min-w-0 flex-1 overflow-y-auto">
        {link === 'reconnecting' && (
          <div role="status" className="fixed left-1/2 top-[calc(10px+env(safe-area-inset-top))] z-50 flex -translate-x-1/2 animate-fade-in items-center gap-2 rounded-full border border-line-strong bg-elevated/95 px-3 py-1.5 text-xs font-medium text-muted shadow-pop backdrop-blur">
            <WifiOff className="size-3.5 text-waiting" aria-hidden />
            Connexion perdue, reconnexion…
          </div>
        )}
        <Switch>
          <Route path="/s/:name">{(p) => <SessionView name={decodeURIComponent(p.name)} />}</Route>
          <Route path="/activity">
            <ActivityPage />
          </Route>
          <Route path="/settings/audit">
            <AuditPage />
          </Route>
          <Route path="/settings">
            <SettingsPage onLogout={() => void logout()} onShortcuts={openHelp} />
          </Route>
          <Route>
            <Home onNew={openNew} />
          </Route>
        </Switch>
      </main>

      {!inSession && <BottomNav badge={waiting} />}
      {!inSession && location === '/' && !!sessions?.length && (
        <button
          type="button"
          onClick={openNew}
          aria-label="Nouvelle session"
          className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 animate-pop items-center justify-center rounded-2xl bg-accent text-on-accent shadow-pop transition-transform active:scale-95 lg:hidden"
        >
          <Plus className="size-6" strokeWidth={2.4} />
        </button>
      )}

      <NewSessionSheet open={newOpen} onOpenChange={setNewOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewSession={openNew}
        onShortcuts={openHelp}
        onLogout={() => void logout()}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

function Home({ onNew }: { onNew: () => void }) {
  const { sessions, host } = useLive();
  return (
    <>
      {/* Phone: the dashboard */}
      <div className="px-4 pb-nav pt-[calc(8px+env(safe-area-inset-top))] lg:hidden">
        <header className="flex h-14 items-center justify-between">
          <Brand />
        </header>
        <HostStrip host={host} className="mb-4" />
        <div className="mb-3 flex items-end justify-between px-0.5">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Sessions</h1>
        </div>
        {sessions && sessions.length > 0 && (
          <div className="-mt-1 mb-4 px-0.5">
            <Summary sessions={sessions} />
          </div>
        )}
        <SessionList onNew={onNew} />
      </div>
      {/* Desktop: right panel placeholder */}
      <div className="hidden h-full items-center justify-center lg:flex">
        {sessions && sessions.length === 0 ? (
          <div className="max-w-sm text-center">
            <p className="text-base font-semibold text-fg">Rien à surveiller pour l’instant</p>
            <p className="mt-1.5 text-sm text-muted">
              Crée une session avec <Kbd>N</Kbd> : elle apparaîtra à gauche, avec son statut en direct.
            </p>
          </div>
        ) : (
          <div className="max-w-sm text-center">
            <p className="text-base font-semibold text-fg">Choisis une session</p>
            <p className="mt-1.5 text-sm leading-7 text-muted">
              Le terminal et la timeline s’ouvrent ici. <Kbd>J</Kbd> <Kbd>K</Kbd> pour naviguer, <Kbd>Ctrl K</Kbd> pour tout le
              reste.
            </p>
            <Button className="mt-6" onClick={onNew}>
              <Plus className="size-4" aria-hidden />
              Nouvelle session
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
