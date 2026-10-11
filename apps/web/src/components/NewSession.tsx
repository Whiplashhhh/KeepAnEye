import type { TemplateInfo } from '@kae/shared';
import { SESSION_NAME_RE } from '@kae/shared';
import { Bot, FolderGit2, ShieldAlert, SquareTerminal } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { suggestName } from '../lib/format';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import { Button, Sheet, Skeleton, cx } from './ui';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'session';
}

export function NewSessionSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { sessions, refresh } = useLive();
  const toast = useToast();
  const [, navigate] = useLocation();
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [templateId, setTemplateId] = useState('terminal');
  const [project, setProject] = useState('');
  const [flags, setFlags] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(() => (sessions ?? []).map((s) => s.name), [sessions]);
  const template = templates?.find((t) => t.id === templateId);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNameTouched(false);
    setFlags([]);
    void Promise.all([api<{ templates: TemplateInfo[] }>('/api/templates'), api<{ projects: string[] }>('/api/projects')])
      .then(([t, p]) => {
        setTemplates(t.templates);
        setProjects(p.projects);
        setProject((cur) => (cur && p.projects.includes(cur) ? cur : (p.projects[0] ?? '')));
      })
      .catch((e: Error) => setError(e.message));
  }, [open]);

  // Prefill a name that follows the choices until the user edits it.
  useEffect(() => {
    if (nameTouched) return;
    const base = template?.requiresProject && project ? slug(project) : template?.kind === 'claude' ? 'claude' : 'shell';
    setName(existing.includes(base) || base === 'shell' ? suggestName(existing, base) : base);
  }, [template, project, existing, nameTouched]);

  const nameValid = SESSION_NAME_RE.test(name);
  const nameTaken = existing.includes(name);
  const canSubmit = nameValid && !nameTaken && !!template && (!template.requiresProject || !!project) && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !template) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/sessions', {
        method: 'POST',
        body: { name, template: template.id, project: template.requiresProject ? project : undefined, flags },
      });
      await refresh().catch(() => undefined);
      onOpenChange(false);
      toast({ kind: 'success', title: `Session « ${name} » créée` });
      navigate(`/s/${encodeURIComponent(name)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nouvelle session" wide>
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-muted">Modèle</legend>
          {templates ? (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {templates.map((t) => {
                const Icon = t.kind === 'claude' ? Bot : SquareTerminal;
                const active = t.id === templateId;
                return (
                  <label
                    key={t.id}
                    className={cx(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                      active ? 'border-accent/70 bg-accent-soft' : 'border-line bg-surface hover:border-line-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={t.id}
                      checked={active}
                      onChange={() => {
                        setTemplateId(t.id);
                        setFlags([]);
                      }}
                      className="sr-only"
                    />
                    <span
                      className={cx(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
                        active ? 'bg-accent text-on-accent' : 'bg-surface-3 text-muted',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg">{t.label}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted">{t.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          )}
        </fieldset>

        {template?.requiresProject && (
          <div>
            <label htmlFor="ns-project" className="mb-2 block text-[13px] font-medium text-muted">
              Projet <span className="font-mono text-faint">~/claude-box/workspace</span>
            </label>
            {projects && projects.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
                Aucun dossier dans <span className="font-mono">~/claude-box/workspace</span>. Crée un projet puis réessaie.
              </p>
            ) : (
              <div className="relative">
                <FolderGit2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                <select
                  id="ns-project"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="h-11 w-full appearance-none rounded-md border border-line bg-surface pl-9 pr-9 font-mono text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25"
                >
                  {(projects ?? []).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden>
                  ▾
                </span>
              </div>
            )}
          </div>
        )}

        {template?.flags.map((f) => {
          const checked = flags.includes(f.id);
          return (
            <label
              key={f.id}
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                checked ? 'border-waiting/50 bg-waiting-soft' : 'border-line bg-surface',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setFlags((cur) => (e.target.checked ? [...cur, f.id] : cur.filter((x) => x !== f.id)))}
                className="mt-0.5 size-[18px] shrink-0 accent-[var(--waiting)]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  {f.label}
                  {f.id === 'autonomous' && <ShieldAlert className="size-4 text-waiting" aria-hidden />}
                </span>
                {f.description && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{f.description}</span>}
              </span>
            </label>
          );
        })}

        <div>
          <label htmlFor="ns-name" className="mb-2 block text-[13px] font-medium text-muted">
            Nom
          </label>
          <input
            id="ns-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={40}
            aria-invalid={!nameValid || nameTaken}
            aria-describedby="ns-name-help"
            className={cx(
              'h-11 w-full rounded-md border bg-surface px-3 font-mono text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25',
              !nameValid || nameTaken ? 'border-error/60' : 'border-line',
            )}
          />
          <p id="ns-name-help" className={cx('mt-1.5 text-xs', !nameValid || nameTaken ? 'text-error' : 'text-faint')}>
            {nameTaken
              ? 'Ce nom est déjà pris.'
              : nameValid
                ? 'Lettres, chiffres, - et _ (40 max).'
                : 'Utilise seulement des lettres, chiffres, - et _ (40 max).'}
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-error/40 bg-error-soft px-3.5 py-2.5 text-sm text-error">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button onClick={() => onOpenChange(false)} variant="ghost" size="lg" className="sm:h-10">
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} loading={busy} className="sm:h-10">
            Créer la session
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
