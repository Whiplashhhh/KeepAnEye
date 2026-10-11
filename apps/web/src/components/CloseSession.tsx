import type { SessionInfo } from '@kae/shared';
import * as AlertDialog from '@radix-ui/react-dialog';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import { Button } from './ui';

export function CloseSessionDialog({
  session,
  open,
  onOpenChange,
}: {
  session: SessionInfo | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { refresh } = useLive();
  const [location, navigate] = useLocation();
  if (!session) return null;
  const working = session.claude?.status === 'working';
  const waiting = session.claude?.status === 'waiting';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/sessions/${encodeURIComponent(session.name)}`, { method: 'DELETE' });
      onOpenChange(false);
      toast({ kind: 'success', title: `Session « ${session.name} » fermée` });
      if (location.startsWith(`/s/${encodeURIComponent(session.name)}`)) navigate('/');
      await refresh().catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-scrim backdrop-blur-[2px]" />
        <AlertDialog.Content
          role="alertdialog"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 animate-pop rounded-xl border border-line-strong bg-elevated p-5 shadow-pop outline-none"
        >
          <AlertDialog.Title className="text-[17px] font-semibold text-fg">Fermer la session ?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-muted">
            La session tmux <span className="font-mono font-semibold text-fg">{session.name}</span> et tout ce qui
            tourne dedans seront arrêtés. Cette action est définitive.
          </AlertDialog.Description>
          {(working || waiting) && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-waiting/40 bg-waiting-soft px-3.5 py-3 text-sm text-waiting">
              {working ? (
                <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin [animation-duration:2.4s]" aria-hidden />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span className="font-medium">
                {working ? 'Claude est en train de travailler : son travail en cours sera interrompu.' : 'Claude attend ta réponse dans cette session.'}
              </span>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-error">
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close asChild>
              <Button variant="ghost" size="lg" className="sm:h-10">
                Annuler
              </Button>
            </AlertDialog.Close>
            <Button variant="danger" size="lg" className="sm:h-10" onClick={confirm} loading={busy}>
              Fermer {session.name}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
