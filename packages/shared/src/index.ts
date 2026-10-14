import { z } from 'zod';

/** tmux session names accepted by the app (also used for anything we create). */
export const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/;
export const sessionNameSchema = z.string().regex(SESSION_NAME_RE, 'Nom de session invalide');

/** Project folder names inside ~/claude-box/workspace. */
export const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;

/**
 * GitHub repo to clone into the workspace: "owner/repo", also accepting a github.com URL or SSH remote.
 * The project folder is the repo name. Returns null when the input isn't a usable repo reference.
 */
export function parseRepoRef(input: string): { repo: string; project: string } | null {
  const s = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]/i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const m = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\/([a-zA-Z0-9._-]{1,80})$/.exec(s);
  if (!m) return null;
  const project = m[2]!;
  if (project === '.' || project === '..' || project.startsWith('.')) return null;
  return { repo: `${m[1]}/${project}`, project };
}

export const CLAUDE_STATUSES = ['waiting', 'working', 'done', 'error', 'idle'] as const;
export type ClaudeStatus = (typeof CLAUDE_STATUSES)[number];

/** Sort priority: what waits for me first, then what works, then the rest. */
export const STATUS_PRIORITY: Record<ClaudeStatus, number> = {
  waiting: 0,
  working: 1,
  error: 2,
  done: 3,
  idle: 4,
};

export const SESSION_KINDS = ['terminal', 'claude'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export interface WindowInfo {
  index: number;
  name: string;
  active: boolean;
  command: string;
  path: string;
}

export interface ClaudeInfo {
  status: ClaudeStatus;
  lastEvent: string | null;
  lastMessage: string | null;
  updatedAt: number | null;
  hasTranscript: boolean;
}

export interface SessionInfo {
  name: string;
  kind: SessionKind;
  project: string | null;
  template: string | null;
  createdAt: number;
  activityAt: number;
  attached: number;
  windows: WindowInfo[];
  preview: string[];
  /** Name of the saved SSH machine this terminal is connected to, if any. */
  sshHost: string | null;
  /** Whether the name passes validation (sessions created outside the app may not). */
  manageable: boolean;
  claude: ClaudeInfo | null;
}

export interface HostInfo {
  hostname: string;
  cpu: number;
  load: [number, number, number];
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  uptime: number;
  container: {
    state: 'running' | 'stopped' | 'unknown';
    detail: string;
  };
  updatedAt: number;
}

export interface TemplateFlag {
  id: string;
  label: string;
  description?: string;
}

/** One pick in a template's "model" or "effort" list; its args are added to the command when chosen. */
export interface TemplateChoice {
  id: string;
  label: string;
  description?: string;
}

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  kind: SessionKind;
  requiresProject: boolean;
  /** The session connects to one of the saved SSH machines, picked at creation. */
  requiresSshHost: boolean;
  flags: TemplateFlag[];
  /** Models the user can pick (none picked = the CLI default). */
  models: TemplateChoice[];
  /** Thinking effort levels the user can pick (none picked = the CLI default). */
  efforts: TemplateChoice[];
  /** The user may pick the working directory (otherwise the template's own cwd is used). */
  chooseCwd: boolean;
}

/** One level of the folder picker: sub-directories only. */
export interface DirListing {
  path: string;
  /** null at the filesystem root. */
  parent: string | null;
  entries: { name: string; hidden: boolean }[];
  /** More entries than the server sends back. */
  truncated: boolean;
}

export interface ActivityItem {
  id: number;
  ts: number;
  session: string;
  status: ClaudeStatus;
  text: string;
}

export interface AuditEntry {
  id: number;
  ts: number;
  event: string;
  ip: string | null;
  userAgent: string | null;
  detail: Record<string, unknown> | null;
}

export type TimelineItem =
  | { kind: 'user'; ts: number | null; text: string }
  | { kind: 'assistant'; ts: number | null; text: string }
  | { kind: 'tool'; ts: number | null; tool: string; summary: string }
  | { kind: 'result'; ts: number | null; text: string; isError: boolean };

export interface Timeline {
  available: boolean;
  reason?: string;
  items: TimelineItem[];
  filesTouched: string[];
  lastAssistant: string | null;
}

export const NOTIFY_TYPES = ['waiting', 'done', 'error'] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM)');

export const notificationSettingsSchema = z.object({
  types: z.object({ waiting: z.boolean(), done: z.boolean(), error: z.boolean() }),
  dnd: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }),
  /** "Task done" is only notified when the task ran at least this many minutes (0 = always). */
  doneMinMinutes: z.number().int().min(0).max(240).default(0),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  types: { waiting: true, done: true, error: true },
  dnd: { enabled: false, start: '22:30', end: '07:30' },
  doneMinMinutes: 0,
};

// ---------- Request bodies ----------

export const passwordLoginSchema = z.object({ password: z.string().min(1).max(1024) });

export const secondFactorSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6)
    .max(32)
    .transform((s) => s.replace(/[\s-]/g, '')),
});

export const createSessionSchema = z.object({
  name: sessionNameSchema,
  template: z.string().min(1).max(40),
  project: z.string().max(80).optional(),
  /** GitHub repo ("owner/repo") to clone into the workspace first; replaces `project`. */
  repo: z.string().max(200).optional(),
  flags: z.array(z.string().max(40)).max(10).default([]),
  /** Id of one of the template's models / efforts; omitted = the CLI default. */
  model: z.string().max(40).optional(),
  effort: z.string().max(40).optional(),
  /** Id of a saved SSH machine, for templates that connect to one. */
  sshHost: z.number().int().positive().optional(),
  /** Absolute working directory, for templates that let the user choose it; omitted = the template's cwd. */
  cwd: z.string().min(1).max(4096).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// ---------- SSH machines ----------

/** Hostname, IPv4 or ~/.ssh/config alias (never starts with "-": it would be read as an ssh option). */
export const SSH_HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$/;
const SSH_IPV6_RE = /^(?=.*:)[0-9A-Fa-f:]{2,45}$/;
export const SSH_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
export const SSH_LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

export const sshHostInputSchema = z.object({
  /** Name shown in the app (unique). */
  name: z.string().trim().regex(SSH_LABEL_RE, 'Nom invalide : lettres, chiffres, espaces, . - _ (40 max).'),
  host: z
    .string()
    .trim()
    .refine((h) => SSH_HOSTNAME_RE.test(h) || SSH_IPV6_RE.test(h), 'Adresse invalide : nom d’hôte, IP ou alias de ~/.ssh/config.'),
  port: z.number().int().min(1).max(65535).default(22),
  /** Remote user; omitted = ssh's own default (current user, or ~/.ssh/config). */
  user: z
    .string()
    .trim()
    .regex(SSH_USER_RE, 'Utilisateur invalide.')
    .nullish()
    .transform((u) => u ?? null),
  /** Absolute path of a private key on the app's host; omitted = ssh's defaults (agent, ~/.ssh/id_*). */
  identityFile: z
    .string()
    .trim()
    .max(4096)
    .refine((p) => p.startsWith('/') && !p.includes('\0'), 'Chemin invalide : il doit être absolu.')
    .nullish()
    .transform((p) => p || null),
});
export type SshHostInput = z.infer<typeof sshHostInputSchema>;

export interface SshHost {
  id: number;
  name: string;
  host: string;
  port: number;
  user: string | null;
  identityFile: string | null;
  createdAt: number;
}

export const listDirQuerySchema = z.object({ path: z.string().min(1).max(4096).optional() });

export const makeDirSchema = z.object({
  parent: z.string().min(1).max(4096),
  name: z.string().min(1).max(255),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

// ---------- WebSocket messages ----------

export type LiveMessage =
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'host'; host: HostInfo }
  | { type: 'activity'; item: ActivityItem }
  | { type: 'bye'; reason: string };

export const terminalClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(64 * 1024) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(2).max(500),
  }),
  // Touch scrolling: positive = towards older output (up), negative = back towards the bottom.
  z.object({ type: z.literal('scroll'), lines: z.number().int().min(-500).max(500) }),
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export interface ApiError {
  error: string;
  message: string;
}

export function sortSessions(sessions: SessionInfo[]): SessionInfo[] {
  const rank = (s: SessionInfo) => (s.claude ? STATUS_PRIORITY[s.claude.status] : 5);
  return [...sessions].sort((a, b) => rank(a) - rank(b) || b.activityAt - a.activityAt || a.name.localeCompare(b.name));
}
