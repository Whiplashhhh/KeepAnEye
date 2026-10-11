import type { AuditEntry } from '@kae/shared';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, CircleX, KeyRound, LogIn, LogOut, Plus, ShieldAlert, SquareTerminal, Trash2, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Button, EmptyState, Skeleton, cx } from '../components/ui';
import { api } from '../lib/api';

const EVENTS: Record<string, { label: string; icon: LucideIcon; tone?: 'bad' | 'warn' }> = {
  'login.success': { label: 'Connexion réussie', icon: LogIn },
  'login.password_ok': { label: 'Mot de passe correct', icon: KeyRound },
  'login.password_failed': { label: 'Mot de passe incorrect', icon: CircleX, tone: 'bad' },
  'login.second_factor_failed': { label: 'Code 2FA incorrect', icon: CircleX, tone: 'bad' },
  'login.recovery_code_used': { label: 'Code de secours utilisé', icon: ShieldAlert, tone: 'warn' },
  'login.blocked': { label: 'Tentative bloquée', icon: ShieldAlert, tone: 'bad' },
  logout: { label: 'Déconnexion', icon: LogOut },
  'logout.all': { label: 'Déconnexion de tous les appareils', icon: LogOut, tone: 'warn' },
  'session.created': { label: 'Session créée', icon: Plus },
  'session.closed': { label: 'Session fermée', icon: Trash2 },
  'terminal.opened': { label: 'Terminal ouvert', icon: SquareTerminal },
  'admin.init': { label: 'Compte initialisé (CLI)', icon: UserCog },
  'admin.reset_2fa': { label: '2FA réinitialisée (CLI)', icon: UserCog, tone: 'warn' },
  'admin.reset_password': { label: 'Mot de passe changé (CLI)', icon: UserCog, tone: 'warn' },
};

function describe(e: AuditEntry): string | null {
  const d = e.detail ?? {};
  if (typeof d.name === 'string') return d.name;
  if (typeof d.method === 'string') return d.method === 'recovery' ? 'via code de secours' : 'via TOTP';
  if (typeof d.remaining === 'number') return `${d.remaining} code(s) restant(s)`;
  return null;
}

function ua(s: string | null): string {
  if (!s) return '';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  const br = /Firefox\//.test(s) ? 'Firefox' : /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ');
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = async (before?: number) => {
    setLoading(true);
    try {
      const r = await api<{ entries: AuditEntry[] }>(`/api/audit?limit=100${before ? `&before=${before}` : ''}`);
      setEntries((cur) => (before && cur ? [...cur, ...r.entries] : r.entries));
      setMore(r.entries.length === 100);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-nav pt-4 safe-top lg:px-8 lg:pb-10 lg:pt-8">
      <Link href="/settings" className="-ml-2 mb-3 inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />
        Réglages
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Journal d’audit</h1>
        <p className="mt-1 text-sm text-muted">Toutes les connexions et actions sensibles, les plus récentes en premier.</p>
      </header>
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-error/40 bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}
      {!entries && !error && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      )}
      {entries && entries.length === 0 && <EmptyState icon={<ScrollTextIcon />} title="Journal vide" />}
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {entries.map((e) => {
            const meta = EVENTS[e.event] ?? { label: e.event, icon: ShieldAlert };
            const Icon = meta.icon;
            const detail = describe(e);
            return (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                <Icon
                  className={cx('mt-0.5 size-4 shrink-0', meta.tone === 'bad' ? 'text-error' : meta.tone === 'warn' ? 'text-waiting' : 'text-muted')}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">
                    <span className="font-medium">{meta.label}</span>
                    {detail && <span className="font-mono text-[13px] text-muted"> · {detail}</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-faint">
                    <span className="font-mono">{e.ip ?? '—'}</span>
                    {ua(e.userAgent) && ` · ${ua(e.userAgent)}`}
                  </p>
                </div>
                <time className="tabular shrink-0 text-xs text-faint" dateTime={new Date(e.ts).toISOString()}>
                  {new Date(e.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      {entries && more && entries.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => void load(entries[entries.length - 1]!.id)} loading={loading}>
            Plus ancien
          </Button>
        </div>
      )}
    </div>
  );
}

function ScrollTextIcon() {
  return <ShieldAlert className="size-6" />;
}
