import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { TemplateInfo } from '@kae/shared';
import { SESSION_KINDS } from '@kae/shared';
import { z } from 'zod';

const tokenRe = /^[a-zA-Z0-9_-]{1,40}$/;

const templateSchema = z.object({
  id: z.string().regex(tokenRe),
  label: z.string().min(1).max(60),
  description: z.string().max(200).default(''),
  kind: z.enum(SESSION_KINDS),
  requiresProject: z.boolean().default(false),
  /** argv with placeholders: {session} {project} {home} {claudeBoxDir} {workspaceDir}; "{flags}" alone expands to the selected flags' args. Empty = default shell. */
  command: z.array(z.string().max(500)).max(64).default([]),
  /** Keep the session open with its output if the command fails (e.g. claude-box is down). */
  keepOnFailure: z.boolean().default(false),
  /** Working directory (placeholders allowed). Defaults to {home}. */
  cwd: z.string().max(500).default('{home}'),
  flags: z
    .array(
      z.object({
        id: z.string().regex(tokenRe),
        label: z.string().min(1).max(60),
        description: z.string().max(200).optional(),
        args: z.array(z.string().max(200)).max(16),
      }),
    )
    .max(10)
    .default([]),
});

export type Template = z.infer<typeof templateSchema>;

export const templatesFileSchema = z
  .object({ templates: z.array(templateSchema).min(1).max(50) })
  .refine((f) => new Set(f.templates.map((t) => t.id)).size === f.templates.length, 'Identifiants de modèles en double');

export function loadTemplates(file: string): Template[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const parsed = templatesFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Fichier de modèles invalide (${file}) : ${parsed.error.issues.map((i) => i.message).join(', ')}`);
  }
  return parsed.data.templates;
}

export function toTemplateInfo(t: Template): TemplateInfo {
  return {
    id: t.id,
    label: t.label,
    description: t.description,
    kind: t.kind,
    requiresProject: t.requiresProject,
    flags: t.flags.map(({ id, label, description }) => (description ? { id, label, description } : { id, label })),
  };
}

export interface ExpandContext {
  session: string;
  project: string | null;
  claudeBoxDir: string;
  workspaceDir: string;
  home?: string;
}

/** Values are validated before reaching here (session regex, project checked against the workspace). */
function substitute(s: string, ctx: ExpandContext): string {
  return s.replace(/\{(session|project|home|claudeBoxDir|workspaceDir)\}/g, (_m, key: string) => {
    switch (key) {
      case 'session':
        return ctx.session;
      case 'project':
        return ctx.project ?? '';
      case 'home':
        return ctx.home ?? homedir();
      case 'claudeBoxDir':
        return ctx.claudeBoxDir;
      default:
        return ctx.workspaceDir;
    }
  });
}

export function expandTemplate(t: Template, ctx: ExpandContext, flagIds: string[]): { command: string[]; cwd: string } {
  const unknown = flagIds.filter((f) => !t.flags.some((tf) => tf.id === f));
  if (unknown.length) throw new Error(`Option inconnue : ${unknown.join(', ')}`);
  const flagArgs = t.flags.filter((f) => flagIds.includes(f.id)).flatMap((f) => f.args);
  const command: string[] = [];
  for (const part of t.command) {
    if (part === '{flags}') command.push(...flagArgs.map((a) => substitute(a, ctx)));
    else command.push(substitute(part, ctx));
  }
  return { command, cwd: substitute(t.cwd, ctx) };
}
