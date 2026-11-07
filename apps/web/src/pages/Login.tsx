import { LockKeyhole } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { BrandMark } from '../components/Brand';
import { Button } from '../components/ui';
import { api } from '../lib/api';

type Stage = 'password' | 'uninitialized';

export function LoginPage({ stage, onDone }: { stage: Stage; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/password', { method: 'POST', body: { password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-full items-center justify-center overflow-hidden px-4 pb-[calc(40px+env(safe-area-inset-bottom))] pt-[calc(40px+env(safe-area-inset-top))]">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-30%] h-[60vh] w-[120vw] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl dark:bg-accent/[0.07]"
      />
      <div className="relative w-full max-w-sm animate-rise">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-14" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-fg">Keep An Eye</h1>
          <p className="mt-1 text-sm text-muted">
Tour de contrôle de tes sessions.
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-pop">
          {stage === 'uninitialized' && (
            <div className="text-sm leading-relaxed text-muted">
              <p className="font-medium text-fg">Aucun compte n’est encore configuré.</p>
              <p className="mt-2">Sur le serveur, dans le dossier de l’appli, lance :</p>
              <pre className="mt-3 rounded-md bg-surface-2 px-3 py-2 font-mono text-[13px] text-fg">npm run admin:init</pre>
              <Button className="mt-5 w-full" onClick={() => location.reload()}>
                J’ai terminé, recharger
              </Button>
            </div>
          )}

          {stage === 'password' && (
            <form onSubmit={submitPassword} className="space-y-4">
              <div>
                <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-muted">
                  Mot de passe
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-md border border-line bg-surface-2/40 pl-9 pr-3 text-[15px] text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25"
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="text-sm text-error">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!password}>
                Se connecter
              </Button>
            </form>
          )}

        </div>
        <p className="mt-6 text-center text-xs text-faint">Accès réservé · connexion journalisée</p>
        <p className="mt-2 text-center text-xs text-faint">Créé par Willem Vanbaelinghem</p>
      </div>
    </main>
  );
}
