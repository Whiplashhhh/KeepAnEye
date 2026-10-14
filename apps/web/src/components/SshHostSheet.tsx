import type { SshHost } from '@kae/shared';
import { sshHostInputSchema } from '@kae/shared';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, Sheet, cx } from './ui';

const INPUT =
  'h-11 w-full rounded-md border bg-surface px-3 font-mono text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25';

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {(error || hint) && <p className={cx('mt-1.5 text-xs', error ? 'text-error' : 'text-faint')}>{error ?? hint}</p>}
    </div>
  );
}

/** Add or edit a saved SSH machine. Nothing secret is stored: authentication is left to ssh (agent, keys, password typed in the terminal). */
export function SshHostSheet({
  open,
  onOpenChange,
  host,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  host?: SshHost | null;
  onSaved: (host: SshHost) => void;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [user, setUser] = useState('');
  const [port, setPort] = useState('22');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(host?.name ?? '');
    setAddress(host?.host ?? '');
    setUser(host?.user ?? '');
    setPort(String(host?.port ?? 22));
    setKey(host?.identityFile ?? '');
    setError(null);
  }, [open, host]);

  const parsed = sshHostInputSchema.safeParse({
    name,
    host: address,
    port: Number(port),
    user: user.trim() || null,
    identityFile: key.trim() || null,
  });
  const issue = (field: string) => (parsed.success ? null : (parsed.error.issues.find((i) => i.path[0] === field)?.message ?? null));
  // Show a field's error only once it has content, so an empty fresh form is not red.
  const shown = (field: string, value: string) => (value.trim() ? issue(field) : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.success || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ host: SshHost }>(host ? `/api/ssh-hosts/${host.id}` : '/api/ssh-hosts', {
        method: host ? 'PUT' : 'POST',
        body: parsed.data,
      });
      onSaved(res.host);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const text = { autoComplete: 'off', autoCapitalize: 'off', spellCheck: false } as const;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={host ? 'Modifier la machine' : 'Ajouter une machine SSH'}
      description="Le serveur se connecte avec ses clés SSH (ssh-agent, ~/.ssh). Aucun mot de passe n’est enregistré : s’il en faut un, tu le tapes dans le terminal."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field id="ssh-name" label="Nom" error={shown('name', name)} hint="Comment tu veux la retrouver, par ex. « VPS Hetzner ».">
          <input
            id="ssh-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="VPS"
            aria-invalid={!!shown('name', name)}
            className={cx(INPUT, shown('name', name) ? 'border-error/60' : 'border-line')}
            {...text}
          />
        </Field>
        <div className="grid grid-cols-[1fr_6.5rem] gap-3">
          <Field id="ssh-host" label="Adresse" error={shown('host', address)}>
            <input
              id="ssh-host"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="vps.exemple.fr ou 203.0.113.7"
              inputMode="url"
              aria-invalid={!!shown('host', address)}
              className={cx(INPUT, shown('host', address) ? 'border-error/60' : 'border-line')}
              {...text}
            />
          </Field>
          <Field id="ssh-port" label="Port" error={issue('port')}>
            <input
              id="ssh-port"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              aria-invalid={!!issue('port')}
              className={cx(INPUT, issue('port') ? 'border-error/60' : 'border-line')}
              {...text}
            />
          </Field>
        </div>
        <Field id="ssh-user" label="Utilisateur (facultatif)" error={shown('user', user)} hint="Vide : celui de ton ~/.ssh/config, sinon l’utilisateur du serveur.">
          <input
            id="ssh-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="root"
            aria-invalid={!!shown('user', user)}
            className={cx(INPUT, shown('user', user) ? 'border-error/60' : 'border-line')}
            {...text}
          />
        </Field>
        <Field id="ssh-key" label="Clé privée (facultatif)" error={shown('identityFile', key)} hint="Chemin sur le serveur, par ex. /home/toi/.ssh/id_ed25519_vps. Vide : les clés par défaut.">
          <input
            id="ssh-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="/home/toi/.ssh/id_ed25519"
            aria-invalid={!!shown('identityFile', key)}
            className={cx(INPUT, shown('identityFile', key) ? 'border-error/60' : 'border-line')}
            {...text}
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-md border border-error/40 bg-error-soft px-3.5 py-2.5 text-sm text-error">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button onClick={() => onOpenChange(false)} variant="ghost" size="lg" className="sm:h-10">
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="lg" disabled={!parsed.success} loading={busy} className="sm:h-10">
            {host ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

/** "user@host:port" as shown in lists. */
export function sshTarget(h: Pick<SshHost, 'host' | 'port' | 'user'>): string {
  return `${h.user ? `${h.user}@` : ''}${h.host}${h.port !== 22 ? `:${h.port}` : ''}`;
}
