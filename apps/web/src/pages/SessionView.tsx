import { ArrowLeft, Bot, ScrollText, SearchX, Server, SquareTerminal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { CloseSessionDialog } from '../components/CloseSession';
import { Keybar } from '../components/Keybar';
import type { TerminalHandle } from '../components/Terminal';
import { Terminal } from '../components/Terminal';
import { Timeline } from '../components/Timeline';
import { Button, EmptyState, IconButton, Segmented, Skeleton, StatusBadge, StatusDot, cx } from '../components/ui';
import { STATUS } from '../lib/status';
import { useLive } from '../lib/live';

/**
 * Tracks the visual viewport while the virtual keyboard is open, so the terminal shrinks above it.
 * Null when the keyboard is closed: the view then sticks to the screen edges, since an installed
 * iOS PWA reports a visual viewport shorter than the screen and that would leave a gap at the bottom.
 */
function useKeyboardViewport(): { height: number; top: number } | null {
  const [vv, setVv] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () =>
      setVv(document.documentElement.clientHeight - v.height > 120 ? { height: v.height, top: v.offsetTop } : null);
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
    };
  }, []);
  return vv;
}

function useIsDesktop(): boolean {
  const [d, setD] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setD(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return d;
}

function useCoarsePointer(): boolean {
  return useState(() => window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 640px)').matches)[0];
}

export function SessionView({ name }: { name: string }) {
  const { sessions } = useLive();
  const session = sessions?.find((s) => s.name === name) ?? null;
  const [tab, setTab] = useState<'terminal' | 'timeline'>('terminal');
  const [closing, setClosing] = useState(false);
  const termRef = useRef<TerminalHandle>(null);
  const desktop = useIsDesktop();
  const coarse = useCoarsePointer();
  const vv = useKeyboardViewport();

  useEffect(() => setTab('terminal'), [name]);

  // Lock page scroll while the full-screen terminal is shown on phones.
  useEffect(() => {
    if (desktop) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [desktop]);

  if (sessions && !session) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<SearchX className="size-6" />}
          title="Session introuvable"
          action={
            <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface-2 px-4 text-sm text-fg hover:border-line-strong">
              <ArrowLeft className="size-4" aria-hidden />
              Retour aux sessions
            </Link>
          }
        >
          <span className="font-mono">{name}</span> n’existe plus : elle a peut-être été fermée depuis un autre appareil.
        </EmptyState>
      </div>
    );
  }

  const isClaude = session?.kind === 'claude';
  const status = session?.claude?.status;
  const style = !desktop && vv ? { top: vv.top, height: vv.height } : undefined;

  return (
    <div
      className={cx('flex flex-col bg-bg', desktop ? 'h-full' : vv ? 'fixed inset-x-0 top-0 z-30' : 'fixed inset-0 z-30')}
      style={style}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-elevated px-2 safe-top lg:h-16 lg:px-5">
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-1.5">
          <Link
            href="/"
            aria-label="Retour aux sessions"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg lg:hidden"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            {session ? (
              <>
                <h1 className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-[15px] font-semibold text-fg">{session.name}</span>
                  {status && (
                    <span className="hidden sm:inline-flex">
                      <StatusBadge status={status} size="sm" />
                    </span>
                  )}
                </h1>
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  {status && (
                    <span className={cx('inline-flex shrink-0 items-center gap-1.5 font-medium sm:hidden', STATUS[status].text)}>
                      <StatusDot status={status} />
                      {STATUS[status].label}
                      <span className="text-faint" aria-hidden>
                        ·
                      </span>
                    </span>
                  )}
                  {isClaude ? <Bot className="hidden size-3.5 shrink-0 sm:block" aria-hidden /> : (session.sshHost ? <Server className="size-3.5 shrink-0" aria-hidden /> : <SquareTerminal className="size-3.5 shrink-0" aria-hidden />)}
                  <span className="truncate">{isClaude ? (session.project ?? 'projet inconnu') : session.sshHost ? `SSH · ${session.sshHost}` : 'Terminal sur l’hôte'}</span>
                </p>
              </>
            ) : (
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            )}
          </div>
        </div>
        {isClaude && (
          <div className="hidden sm:block">
            <Segmented
              label="Vue"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'terminal', label: 'Terminal', icon: <SquareTerminal className="size-3.5" aria-hidden /> },
                { value: 'timeline', label: 'Timeline', icon: <ScrollText className="size-3.5" aria-hidden /> },
              ]}
            />
          </div>
        )}
        {isClaude && (
          <IconButton
            label={tab === 'terminal' ? 'Voir la timeline' : 'Voir le terminal'}
            className="sm:hidden"
            onClick={() => setTab(tab === 'terminal' ? 'timeline' : 'terminal')}
          >
            {tab === 'terminal' ? <ScrollText className="size-5" /> : <SquareTerminal className="size-5" />}
          </IconButton>
        )}
        {session?.manageable && (
          <>
            <IconButton label="Fermer la session" className="lg:hidden" onClick={() => setClosing(true)}>
              <Trash2 className="size-5" />
            </IconButton>
            <span className="hidden lg:block">
              <Button variant="ghost" onClick={() => setClosing(true)}>
                <Trash2 className="size-4" aria-hidden />
                Fermer
              </Button>
            </span>
          </>
        )}
      </header>

      {session?.claude?.lastMessage && (status === 'waiting' || status === 'error') && (
        <div
          role="status"
          className={cx(
            'shrink-0 animate-fade-in border-b px-4 py-2 text-[13px] font-medium lg:px-6',
            status === 'waiting' ? 'border-waiting/30 bg-waiting-soft text-waiting' : 'border-error/30 bg-error-soft text-error',
          )}
        >
          <p className="line-clamp-2">{session.claude.lastMessage}</p>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {/* Keep the terminal mounted when viewing the timeline, so the connection stays up. */}
        <Terminal
          ref={termRef}
          session={name}
          className={cx('absolute inset-0', tab !== 'terminal' && 'invisible')}
        />
        {tab === 'timeline' && (
          <div className="absolute inset-0 overflow-y-auto bg-bg">
            <Timeline session={name} />
          </div>
        )}
      </div>

      {coarse && tab === 'terminal' && (
        <div className={cx('shrink-0 bg-elevated', !vv && 'safe-bottom')}>
          <Keybar term={termRef} />
        </div>
      )}

      <CloseSessionDialog session={session} open={closing} onOpenChange={setClosing} />
    </div>
  );
}
