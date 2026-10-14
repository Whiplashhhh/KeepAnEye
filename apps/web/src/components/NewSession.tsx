import type { SshHost, TemplateChoice, TemplateInfo } from '@kae/shared';
import { parseRepoRef, SESSION_NAME_RE } from '@kae/shared';
import { Bot, FolderGit2, Github, Plus, Server, ShieldAlert, SquareTerminal } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '../lib/api';
import { suggestName } from '../lib/format';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';
import { FolderPicker } from './FolderPicker';
import { SshHostSheet, sshTarget } from './SshHostSheet';
import { Button, Sheet, Skeleton, cx } from './ui';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'session';
}

/** Pill radio group with an implicit "Par défaut" (empty value = the CLI default). */
function ChoiceGroup({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: TemplateChoice[];
  value: string;
  onChange: (id: string) => void;
}) {
  const options = [{ id: '', label: 'Par défaut' }, ...choices];
  const hint = choices.find((c) => c.id === value)?.description;
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-muted">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.id === value;
          return (
            <label
              key={o.id}
              className={cx(
                'cursor-pointer rounded-md border px-3 py-2 text-sm font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                active ? 'border-accent/70 bg-accent-soft text-fg' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
              )}
            >
              <input
                type="radio"
                name={`ns-${label}`}
                value={o.id}
                checked={active}
                onChange={() => onChange(o.id)}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
      {hint && <p className="mt-1.5 text-xs text-faint">{hint}</p>}
    </fieldset>
  );
}

export function NewSessionSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { sessions, refresh } = useLive();
  const toast = useToast();
  const [, navigate] = useLocation();
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [templateId, setTemplateId] = useState('terminal');
  const [machines, setMachines] = useState<SshHost[] | null>(null);
  const [machineId, setMachineId] = useState<number | null>(null);
  const [addMachine, setAddMachine] = useState(false);
  const [project, setProject] = useState('');
  const [source, setSource] = useState<'existing' | 'clone'>('existing');
  const [repo, setRepo] = useState('');
  const [flags, setFlags] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [cwdMode, setCwdMode] = useState<'home' | 'custom'>('home');
  const [cwd, setCwd] = useState('');
  const [home, setHome] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const machine = machines?.find((m) => m.id === machineId);
  const existing = useMemo(() => (sessions ?? []).map((s) => s.name), [sessions]);
  const template = templates?.find((t) => t.id === templateId);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNameTouched(false);
    setFlags([]);
    setModel('');
    setEffort('');
    void Promise.all([
      api<{ templates: TemplateInfo[] }>('/api/templates'),
      api<{ projects: string[] }>('/api/projects'),
      api<{ hosts: SshHost[] }>('/api/ssh-hosts'),
    ])
      .then(([t, p, h]) => {
        setTemplates(t.templates);
        setMachines(h.hosts);
        setMachineId((cur) => (cur !== null && h.hosts.some((m) => m.id === cur) ? cur : (h.hosts[0]?.id ?? null)));
        setProjects(p.projects);
        setProject((cur) => (cur && p.projects.includes(cur) ? cur : (p.projects[0] ?? '')));
        if (p.projects.length === 0) setSource('clone');
      })
      .catch((e: Error) => setError(e.message));
  }, [open]);

  const repoRef = parseRepoRef(repo);
  const cloning = !!template?.requiresProject && source === 'clone';
  const chosenProject = cloning ? (repoRef?.project ?? '') : project;
  const customCwd = !!template?.chooseCwd && cwdMode === 'custom';
  // Name the session after the chosen folder, but not after the home folder (that would be the user name).
  const cwdBase = customCwd && cwd !== home ? cwd.split('/').filter(Boolean).pop() : undefined;
  const repoExists = !!repoRef && !!projects?.includes(repoRef.project);

  // Prefill a name that follows the choices until the user edits it.
  useEffect(() => {
    if (nameTouched) return;
    const base =
      template?.requiresProject && chosenProject
        ? slug(chosenProject)
        : cwdBase
          ? slug(cwdBase)
          : template?.requiresSshHost && machine
            ? slug(machine.name)
            : template?.kind === 'claude'
              ? 'claude'
              : 'shell';
    setName(existing.includes(base) || base === 'shell' ? suggestName(existing, base) : base);
  }, [template, chosenProject, cwdBase, machine, existing, nameTouched]);

  const nameValid = SESSION_NAME_RE.test(name);
  const nameTaken = existing.includes(name);
  const canSubmit =
    nameValid && !nameTaken && !!template && (!template.requiresProject || !!chosenProject) && (!template.requiresSshHost || !!machine) && (!customCwd || !!cwd) && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !template) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/sessions', {
        method: 'POST',
        body: {
          name,
          template: template.id,
          project: template.requiresProject && !cloning ? project : undefined,
          repo: cloning ? repoRef?.repo : undefined,
          flags,
          model: model || undefined,
          effort: effort || undefined,
          cwd: customCwd ? cwd : undefined,
          sshHost: template.requiresSshHost ? machine?.id : undefined,
        },
      });
      if (cloning) void api<{ projects: string[] }>('/api/projects').then((p) => setProjects(p.projects)).catch(() => undefined);
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
                const Icon = t.kind === 'claude' ? Bot : t.requiresSshHost ? Server : SquareTerminal;
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
                        setModel('');
                        setEffort('');
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
            <div className="mb-2 flex items-center justify-between gap-3">
              <span id="ns-project-label" className="text-[13px] font-medium text-muted">
                Projet <span className="font-mono text-faint">~/claude-box/workspace</span>
              </span>
              <div
                role="radiogroup"
                aria-label="Source du projet"
                className="flex rounded-md border border-line bg-surface p-0.5 text-[13px]"
              >
                {(
                  [
                    ['existing', 'Existant'],
                    ['clone', 'Cloner un repo'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={source === id}
                    onClick={() => setSource(id)}
                    className={cx(
                      'rounded px-2.5 py-1 font-medium transition-colors',
                      source === id ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {source === 'clone' ? (
              <div>
                <div className="relative">
                  <Github className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                  <input
                    id="ns-repo"
                    aria-labelledby="ns-project-label"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="propriétaire/repo"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    maxLength={200}
                    aria-invalid={!!repo && !repoRef}
                    aria-describedby="ns-repo-help"
                    className={cx(
                      'h-11 w-full rounded-md border bg-surface pl-9 pr-3 font-mono text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25',
                      repo && !repoRef ? 'border-error/60' : 'border-line',
                    )}
                  />
                </div>
                <p id="ns-repo-help" className={cx('mt-1.5 text-xs', repo && !repoRef ? 'text-error' : 'text-faint')}>
                  {repo && !repoRef
                    ? 'Écris-le sous la forme propriétaire/repo (ou colle l’URL GitHub).'
                    : repoExists
                      ? `Le dossier ${repoRef!.project} existe déjà : il sera utilisé tel quel.`
                      : repoRef
                        ? `gh repo clone ${repoRef.repo} → workspace/${repoRef.project}`
                        : 'Cloné avec gh dans claude-box, puis ajouté à la liste des projets.'}
                </p>
              </div>
            ) : projects && projects.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
                Aucun dossier dans <span className="font-mono">~/claude-box/workspace</span>. Clone un repo pour commencer.
              </p>
            ) : (
              <div className="relative">
                <FolderGit2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                <select
                  id="ns-project"
                  aria-labelledby="ns-project-label"
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

        {template?.requiresSshHost && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="ns-machine" className="text-[13px] font-medium text-muted">
                Machine
              </label>
              <button
                type="button"
                onClick={() => setAddMachine(true)}
                className="inline-flex items-center gap-1 rounded text-[13px] font-medium text-muted transition-colors hover:text-fg"
              >
                <Plus className="size-3.5" aria-hidden />
                Ajouter
              </button>
            </div>
            {machines && machines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
                Aucune machine SSH enregistrée. Ajoute ton VPS pour y ouvrir un terminal.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Server className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
                  <select
                    id="ns-machine"
                    value={machineId ?? ''}
                    onChange={(e) => setMachineId(Number(e.target.value))}
                    className="h-11 w-full appearance-none rounded-md border border-line bg-surface pl-9 pr-9 text-sm text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25"
                  >
                    {(machines ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {sshTarget(m)}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden>
                    ▾
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-faint">
                  Un mot de passe ou une confirmation de clé d’hôte te sera demandé dans le terminal si besoin.
                </p>
              </>
            )}
          </div>
        )}

        {template?.chooseCwd && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-muted">Dossier</span>
              <div role="radiogroup" aria-label="Dossier de départ" className="flex rounded-md border border-line bg-surface p-0.5 text-[13px]">
                {(
                  [
                    ['home', 'Dossier personnel'],
                    ['custom', 'Choisir un dossier'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={cwdMode === id}
                    onClick={() => setCwdMode(id)}
                    className={cx(
                      'rounded px-2.5 py-1 font-medium transition-colors',
                      cwdMode === id ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {cwdMode === 'custom' ? (
              <>
                <FolderPicker value={cwd} onChange={setCwd} onHome={setHome} />
                <p className="mt-1.5 truncate text-xs text-faint">
                  Le shell s’ouvrira dans <span className="font-mono text-muted">{cwd || '…'}</span>
                </p>
              </>
            ) : (
              <p className="text-xs text-faint">
                Le shell s’ouvrira dans ton dossier personnel (<span className="font-mono">~</span>).
              </p>
            )}
          </div>
        )}

        {!!template?.models.length && <ChoiceGroup label="Modèle IA" choices={template.models} value={model} onChange={setModel} />}
        {!!template?.efforts.length && (
          <ChoiceGroup label="Capacité de réflexion" choices={template.efforts} value={effort} onChange={setEffort} />
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
            {busy && cloning && !repoExists ? 'Clonage…' : 'Créer la session'}
          </Button>
        </div>
      </form>
      <SshHostSheet
        open={addMachine}
        onOpenChange={setAddMachine}
        onSaved={(m) => {
          setMachines((cur) => [...(cur ?? []), m].sort((a, b) => a.name.localeCompare(b.name)));
          setMachineId(m.id);
        }}
      />
    </Sheet>
  );
}
