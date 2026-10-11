import { ArrowLeft, KeyRound, LockKeyhole } from 'lucide-react';
import type { ClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '../components/Brand';
import { Button, cx } from '../components/ui';
import { api } from '../lib/api';

type Stage = 'password' | 'second-factor' | 'uninitialized';

function OtpInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const set = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, 6);
    onChange(clean);
    refs.current[Math.min(clean.length, 5)]?.focus();
    if (clean.length === 6) onComplete(clean);
  };

  const onInput = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, '');
    if (!d) return;
    if (d.length > 1) return set(value.slice(0, i) + d); // autofill / paste in one box
    set(value.slice(0, i) + d + value.slice(i + 1));
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) onChange(value.slice(0, i) + value.slice(i + 1));
      else if (i > 0) {
        onChange(value.slice(0, i - 1) + value.slice(i));
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    set(e.clipboardData.getData('text'));
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="Code à 6 chiffres">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]*"
          maxLength={i === 0 ? 6 : 1}
          aria-label={`Chiffre ${i + 1}`}
          className={cx(
            'tabular h-14 w-full min-w-0 rounded-md border bg-surface text-center font-mono text-2xl font-semibold text-fg outline-none transition-colors',
            'focus:border-accent focus:ring-2 focus:ring-accent/25',
            d ? 'border-line-strong' : 'border-line',
          )}
        />
      ))}
    </div>
  );
}

export function LoginPage({ initialStage, onDone }: { initialStage: Stage; onDone: () => void }) {
  const [stage, setStage] = useState<Stage>(initialStage);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/password', { method: 'POST', body: { password } });
      setPassword('');
      setStage('second-factor');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/second-factor', { method: 'POST', body: { code: value } });
      onDone();
    } catch (err) {
      const e2 = err as Error & { code?: string };
      setError(e2.message);
      setCode('');
      if (e2.code === 'preauth_expired') setStage('password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10 safe-top safe-bottom">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-30%] h-[60vh] w-[120vw] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl dark:bg-accent/[0.07]"
      />
      <div className="relative w-full max-w-sm animate-rise">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-14" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-fg">Keep An Eye</h1>
          <p className="mt-1 text-sm text-muted">
            {stage === 'second-factor'
              ? recovery
                ? 'Saisis un de tes codes de secours.'
                : 'Code de ton application d’authentification.'
              : 'Tour de contrôle de tes sessions.'}
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
                Continuer
              </Button>
            </form>
          )}

          {stage === 'second-factor' && (
            <div className="space-y-4">
              {recovery ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (recoveryCode.trim()) void submitCode(recoveryCode.trim());
                  }}
                  className="space-y-4"
                >
                  <label htmlFor="recovery" className="block text-[13px] font-medium text-muted">
                    Code de secours
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                    <input
                      id="recovery"
                      autoFocus
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="xxxxx-xxxxx"
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      className="h-12 w-full rounded-md border border-line bg-surface-2/40 pl-9 pr-3 font-mono text-[15px] tracking-wider text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
                    />
                  </div>
                  {error && (
                    <p role="alert" className="text-sm text-error">
                      {error}
                    </p>
                  )}
                  <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!recoveryCode.trim()}>
                    Se connecter
                  </Button>
                </form>
              ) : (
                <>
                  <OtpInput value={code} onChange={setCode} onComplete={(v) => void submitCode(v)} disabled={busy} />
                  {error && (
                    <p role="alert" className="text-center text-sm text-error">
                      {error}
                    </p>
                  )}
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    loading={busy}
                    disabled={code.length !== 6}
                    onClick={() => void submitCode(code)}
                  >
                    Se connecter
                  </Button>
                </>
              )}
              <div className="flex items-center justify-between pt-1 text-[13px]">
                <button
                  type="button"
                  onClick={() => {
                    setStage('password');
                    setError(null);
                  }}
                  className="inline-flex h-9 items-center gap-1 rounded text-muted hover:text-fg"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Mot de passe
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecovery((r) => !r);
                    setError(null);
                  }}
                  className="h-9 rounded text-accent hover:text-accent-strong"
                >
                  {recovery ? 'Utiliser l’application' : 'Utiliser un code de secours'}
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-faint">Accès réservé · connexion journalisée</p>
      </div>
    </main>
  );
}
