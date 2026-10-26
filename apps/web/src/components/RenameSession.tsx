import type { SessionInfo } from '@kae/shared';
import { SESSION_NAME_RE } from '@kae/shared';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import { Button, cx } from './ui';

export function RenameSessionDialog({
  session,
  open,
  onOpenChange,
}: {
  session: SessionInfo | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { sessions, refresh } = useLive();
  const [, navigate] = useLocation();
  if (!session) return null;

  const valid = SESSION_NAME_RE.test(name);
  const taken = name !== session.name && (sessions ?? []).some((s) => s.name === name);
  const unchanged = name === session.name;

  const submit = async () => {
    if (!valid || taken || unchanged || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/sessions/${encodeURIComponent(session.name)}`, { method: 'PATCH', body: { name } });
      onOpenChange(false);
      toast({ kind: 'success', title: `Session renommée « ${name} »` });
      navigate(`/s/${encodeURIComponent(name)}`, { replace: true });
      await refresh().catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o) setName(session.name);
        else setError(null);
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 animate-pop rounded-xl border border-line-strong bg-elevated p-5 shadow-pop outline-none">
          <Dialog.Title className="text-[17px] font-semibold text-fg">Renommer la session</Dialog.Title>
          <Dialog.Description className="sr-only">Choisis un nouveau nom pour la session {session.name}.</Dialog.Description>
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Nouveau nom"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={40}
              autoFocus
              aria-invalid={!valid || taken}
              className={cx(
                'h-11 w-full rounded-md border bg-surface px-3 font-mono text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25',
                !valid || taken ? 'border-error/60' : 'border-line',
              )}
            />
            <p className={cx('mt-1.5 text-xs', !valid || taken ? 'text-error' : 'text-faint')}>
              {taken
                ? 'Ce nom est déjà pris.'
                : valid
                  ? 'Lettres, chiffres, - et _ (40 max).'
                  : 'Utilise seulement des lettres, chiffres, - et _ (40 max).'}
            </p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-error">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="lg" className="sm:h-10">
                  Annuler
                </Button>
              </Dialog.Close>
              <Button type="submit" size="lg" className="sm:h-10" loading={busy} disabled={!valid || taken || unchanged}>
                Renommer
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
