import { Command, PanelLeftClose, PanelLeftOpen, Plus, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Brand, BrandMark } from './components/Brand';
import { CommandPalette } from './components/CommandPalette';
import { HostStrip } from './components/HostStrip';
import { BottomNav, RailNav, SideNav } from './components/Nav';
import { NewSessionSheet } from './components/NewSession';
import { SessionList, Summary } from './components/SessionList';
import { ShortcutsDialog } from './components/Shortcuts';
import { ViewportProbe } from './components/ViewportProbe';
import { Button, IconButton, Kbd, Skeleton } from './components/ui';
import { api, onUnauthorized } from './lib/api';
import { updateAttention } from './lib/favicon';
import { LiveProvider, useLive } from './lib/live';
import { useIsDesktop } from './lib/media';
import { useSidebarCollapsed } from './lib/sidebar';
import { waitingCount } from './lib/status';
import { useTheme } from './lib/theme';
import { ActivityPage } from './pages/Activity';
import { AuditPage } from './pages/Audit';
import { LoginPage } from './pages/Login';
import { GridView, parseGrid } from './pages/GridView';
import { SessionView } from './pages/SessionView';
import { SettingsPage } from './pages/Settings';

type AuthState = { status: 'loading' } | { status: 'in' } | { status: 'out'; stage: 'password' | 'uninitialized' };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  const check = useCallback(async () => {
    try {
      const me = await api<{ authenticated: boolean; stage: 'password' | 'uninitialized' | 'done' }>('/api/auth/me');
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
  if (auth.status === 'out') return <LoginPage stage={auth.stage} onDone={() => setAuth({ status: 'in' })} />;
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
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  const isDesktop = useIsDesktop();
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
        case 'b':
          if (isDesktop) toggleSidebar();
          break;
        case 'g':
          gPressed.current = Date.now();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessions, selected, navigate, toggle, newOpen, paletteOpen, helpOpen, isDesktop, toggleSidebar]);

  const inSession = !!selected;

  return (
    <div className="h-full lg:flex">
      {/* Desktop sidebar, folded into an icon rail when collapsed */}
      {sidebarCollapsed ? (
        <aside className="hidden h-full w-16 shrink-0 flex-col items-center border-r border-line bg-elevated lg:flex" aria-label="Sessions">
          <div className="flex h-16 w-full shrink-0 items-center justify-center border-b border-line">
            <BrandMark />
          </div>
          <div className="flex flex-col items-center gap-1 pt-3">
            <button
              type="button"
              onClick={openNew}
              aria-label="Nouvelle session (N)"
              title="Nouvelle session (N)"
              className="flex size-10 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-strong"
            >
              <Plus className="size-[18px] shrink-0" strokeWidth={2.4} aria-hidden />
            </button>
            <IconButton label="Palette de commandes (Ctrl+K)" className="size-10" onClick={() => setPaletteOpen(true)}>
              <Command className="size-[18px]" aria-hidden />
            </IconButton>
          </div>
          <div className="flex-1" />
          <div className="w-full shrink-0 border-t border-line py-2">
            <RailNav badge={waiting} />
            <div className="mt-1 flex justify-center">
              <IconButton label="Déplier le panneau (B)" className="size-10" onClick={toggleSidebar}>
                <PanelLeftOpen className="size-4" aria-hidden />
              </IconButton>
            </div>
          </div>
        </aside>
      ) : (
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
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <SideNav />
              </div>
              <IconButton label="Rabattre le panneau (B)" className="size-10" onClick={toggleSidebar}>
                <PanelLeftClose className="size-4" aria-hidden />
              </IconButton>
            </div>
          </div>
        </aside>
      )}

      {/* Main area */}
      <main className="min-h-full min-w-0 flex-1 lg:h-full lg:overflow-y-auto">
        {link === 'reconnecting' && (
          <div role="status" className="fixed left-1/2 top-[calc(10px+env(safe-area-inset-top))] z-50 flex -translate-x-1/2 animate-fade-in items-center gap-2 rounded-full border border-line-strong bg-elevated/95 px-3 py-1.5 text-xs font-medium text-muted shadow-pop backdrop-blur">
            <WifiOff className="size-3.5 text-waiting" aria-hidden />
            Connexion perdue, reconnexion…
          </div>
        )}
        <Switch>
          <Route path="/s/:name">{(p) => <SessionView name={decodeURIComponent(p.name)} />}</Route>
          <Route path="/grid/:names?">{(p) => <GridView names={parseGrid(p.names)} onNew={openNew} />}</Route>
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

      {/* Installed iOS PWA: the status bar is translucent, so scrolling content (and the blurred sticky
          headers) would show through behind the clock. A solid cover keeps that strip clean. */}
      {!inSession && <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-bg lg:hidden" />}
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
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ViewportProbe />
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
