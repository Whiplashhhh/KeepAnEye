import type { NotificationSettings } from '@kae/shared';
import { BellRing, ChevronRight, Keyboard, LogOut, Monitor, Moon, ScrollText, ShieldOff, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Button, Segmented, Skeleton, Switch } from '../components/ui';
import { setViewportProbe, viewportProbeEnabled } from '../components/ViewportProbe';
import { api } from '../lib/api';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../lib/push';
import type { ThemePref } from '../lib/theme';
import { useTheme } from '../lib/theme';
import { useToast } from '../lib/toast';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-faint">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const TYPE_LABELS: { key: keyof NotificationSettings['types']; label: string; hint: string }[] = [
  { key: 'waiting', label: 'Claude t’attend', hint: 'Permission demandée ou question posée' },
  { key: 'done', label: 'Tâche terminée', hint: 'Claude a fini de répondre' },
  { key: 'error', label: 'Erreur', hint: 'Échec de l’API ou processus arrêté' },
];

export function SettingsPage({ onLogout, onShortcuts }: { onLogout: () => void; onShortcuts: () => void }) {
  const { pref, setPref } = useTheme();
  const toast = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [devices, setDevices] = useState(0);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [logoutAllBusy, setLogoutAllBusy] = useState(false);
  const [probe, setProbe] = useState(viewportProbeEnabled);

  useEffect(() => {
    api<{ settings: NotificationSettings; devices: number }>('/api/settings/notifications')
      .then((r) => {
        setSettings(r.settings);
        setDevices(r.devices);
      })
      .catch((e: Error) => toast({ kind: 'error', title: 'Réglages indisponibles', detail: e.message }));
    void currentSubscription()
      .then((s) => setSubscribed(!!s))
      .catch(() => setSubscribed(false));
  }, [toast]);

  const save = async (next: NotificationSettings) => {
    const prev = settings;
    setSettings(next);
    try {
      await api('/api/settings/notifications', { method: 'PUT', body: next });
    } catch (e) {
      setSettings(prev);
      toast({ kind: 'error', title: 'Réglage non enregistré', detail: (e as Error).message });
    }
  };

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
        setDevices((d) => Math.max(0, d - 1));
        toast({ kind: 'success', title: 'Notifications désactivées sur cet appareil' });
      } else {
        await enablePush();
        setSubscribed(true);
        setDevices((d) => d + 1);
        toast({ kind: 'success', title: 'Notifications activées', detail: 'Tu seras prévenu quand une session t’attend.' });
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Impossible de changer les notifications', detail: (e as Error).message });
    } finally {
      setPushBusy(false);
    }
  };

  const test = async () => {
    try {
      const r = await api<{ delivered: number }>('/api/push/test', { method: 'POST' });
      toast(
        r.delivered > 0
          ? { kind: 'success', title: 'Notification de test envoyée' }
          : { kind: 'error', title: 'Aucun appareil abonné', detail: 'Active d’abord les notifications sur cet appareil.' },
      );
    } catch (e) {
      toast({ kind: 'error', title: 'Échec de l’envoi', detail: (e as Error).message });
    }
  };

  const logoutAll = async () => {
    setLogoutAllBusy(true);
    try {
      await api('/api/auth/logout-all', { method: 'POST' });
      onLogout();
    } catch (e) {
      toast({ kind: 'error', title: 'Échec', detail: (e as Error).message });
      setLogoutAllBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-nav pt-[calc(28px+env(safe-area-inset-top))] lg:px-8 lg:pb-10 lg:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Réglages</h1>
      </header>

      <Section title="Apparence">
        <Row label="Thème">
          <Segmented<ThemePref>
            label="Thème"
            value={pref}
            onChange={setPref}
            options={[
              { value: 'system', label: 'Auto', icon: <Monitor className="size-3.5" aria-hidden /> },
              { value: 'dark', label: 'Sombre', icon: <Moon className="size-3.5" aria-hidden /> },
              { value: 'light', label: 'Clair', icon: <Sun className="size-3.5" aria-hidden /> },
            ]}
          />
        </Row>
      </Section>

      <Section title="Notifications" description="Reçues sur ton téléphone même quand l’appli est fermée.">
        <Row
          label="Sur cet appareil"
          hint={
            !pushSupported()
              ? 'Non disponible ici. Sur iPhone, installe d’abord l’appli sur l’écran d’accueil.'
              : `${devices} appareil${devices > 1 ? 's' : ''} abonné${devices > 1 ? 's' : ''}`
          }
        >
          {subscribed === null ? (
            <Skeleton className="h-10 w-24" />
          ) : (
            <Button variant={subscribed ? 'secondary' : 'primary'} onClick={togglePush} loading={pushBusy} disabled={!pushSupported()}>
              <BellRing className="size-4" aria-hidden />
              {subscribed ? 'Désactiver' : 'Activer'}
            </Button>
          )}
        </Row>
        {settings ? (
          <>
            {TYPE_LABELS.map((t) => (
              <Row key={t.key} label={t.label} hint={t.hint}>
                <Switch
                  label={t.label}
                  checked={settings.types[t.key]}
                  onChange={(v) => void save({ ...settings, types: { ...settings.types, [t.key]: v } })}
                />
              </Row>
            ))}
            <Row label="Ne pas déranger" hint="Aucune notification sur cette plage horaire">
              <Switch label="Ne pas déranger" checked={settings.dnd.enabled} onChange={(v) => void save({ ...settings, dnd: { ...settings.dnd, enabled: v } })} />
            </Row>
            {settings.dnd.enabled && (
              <div className="flex items-center gap-3 px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-muted">
                  De
                  <input
                    type="time"
                    value={settings.dnd.start}
                    onChange={(e) => e.target.value && void save({ ...settings, dnd: { ...settings.dnd, start: e.target.value } })}
                    className="tabular h-10 rounded-md border border-line bg-surface-2 px-2.5 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-muted">
                  à
                  <input
                    type="time"
                    value={settings.dnd.end}
                    onChange={(e) => e.target.value && void save({ ...settings, dnd: { ...settings.dnd, end: e.target.value } })}
                    className="tabular h-10 rounded-md border border-line bg-surface-2 px-2.5 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  />
                </label>
              </div>
            )}
            <Row label="Tester" hint="Envoie une notification à tous les appareils abonnés">
              <Button onClick={test}>Envoyer</Button>
            </Row>
          </>
        ) : (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
      </Section>

      <Section title="Sécurité">
        <Link href="/settings/audit" className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-surface-2/60">
          <span className="flex items-center gap-3">
            <ScrollText className="size-4 text-muted" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-fg">Journal d’audit</span>
              <span className="block text-[13px] text-muted">Connexions, sessions créées et fermées</span>
            </span>
          </span>
          <ChevronRight className="size-4 text-faint" aria-hidden />
        </Link>
        <Row label="Se déconnecter" hint="Ferme la session sur cet appareil">
          <Button onClick={onLogout}>
            <LogOut className="size-4" aria-hidden />
            Déconnexion
          </Button>
        </Row>
        <Row label="Tous les appareils" hint="Révoque toutes les sessions ouvertes, y compris celle-ci">
          <Button variant="danger-soft" onClick={logoutAll} loading={logoutAllBusy}>
            <ShieldOff className="size-4" aria-hidden />
            Tout déconnecter
          </Button>
        </Row>
      </Section>

      <Section title="Aide">
        <button type="button" onClick={onShortcuts} className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface-2/60">
          <span className="flex items-center gap-3">
            <Keyboard className="size-4 text-muted" aria-hidden />
            <span className="text-sm font-medium text-fg">Raccourcis clavier</span>
          </span>
          <ChevronRight className="size-4 text-faint" aria-hidden />
        </button>
        <Row label="Diagnostic d’affichage" hint="Mesures de l’écran en surimpression (temporaire)">
          <Switch
            label="Diagnostic d’affichage"
            checked={probe}
            onChange={(v) => {
              setProbe(v);
              setViewportProbe(v);
            }}
          />
        </Row>
      </Section>
      <p className="text-center text-xs text-faint">Keep An Eye · créé par Willem Vanbaelinghem · écoute sur 127.0.0.1, servi par Tailscale</p>
    </div>
  );
}
