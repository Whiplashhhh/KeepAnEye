import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repository root: both src/ (tsx) and dist/ (bundle) sit two levels below apps/server. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

const LOOPBACK = new Set(['127.0.0.1', '::1']);

const envSchema = z.object({
  KAE_HOST: z
    .string()
    .default('127.0.0.1')
    .refine((h) => LOOPBACK.has(h), 'KAE_HOST doit être une adresse de loopback (127.0.0.1 ou ::1)'),
  KAE_PORT: z.coerce.number().int().min(1).max(65535).default(7777),
  KAE_ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:7777,http://localhost:7777'),
  KAE_DATA_DIR: z.string().default('./data'),
  KAE_CLAUDE_BOX_DIR: z.string().default('~/claude-box'),
  KAE_WORKSPACE_DIR: z.string().optional(),
  KAE_EVENTS_FILE: z.string().optional(),
  KAE_CLAUDE_HOME_DIR: z.string().optional(),
  KAE_TEMPLATES_FILE: z.string().default('./config/templates.json'),
  KAE_TMUX_BIN: z.string().default('tmux'),
  KAE_TMUX_SOCKET: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,40}$/)
    .optional(),
  KAE_DOCKER_BIN: z.string().default('docker'),
  KAE_HOST_LABEL: z.string().max(60).optional(),
  KAE_SHELL: z.string().optional(),
  KAE_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  KAE_VAPID_SUBJECT: z.string().default('mailto:keep-an-eye@localhost'),
  KAE_WEB_DIST: z.string().default('./apps/web/dist'),
  KAE_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  host: string;
  port: number;
  allowedOrigins: string[];
  dataDir: string;
  dbFile: string;
  claudeBoxDir: string;
  workspaceDir: string;
  eventsFile: string;
  claudeHomeDir: string;
  templatesFile: string;
  tmuxBin: string;
  tmuxSocket: string | undefined;
  dockerBin: string;
  /** Name shown in the host strip (defaults to the machine hostname). */
  hostLabel: string;
  shell: string;
  cookieSecure: boolean;
  vapidSubject: string;
  webDist: string;
  logLevel: string;
}

function resolvePath(p: string): string {
  return path.resolve(REPO_ROOT, expandHome(p));
}

/** Loads `.env` (if present) then validates the environment. Throws a readable error on bad config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, envFile = env.KAE_ENV_FILE ?? path.join(REPO_ROOT, '.env')): Config {
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const claudeBoxDir = resolvePath(e.KAE_CLAUDE_BOX_DIR);
  const dataDir = resolvePath(e.KAE_DATA_DIR);
  const allowedOrigins = e.KAE_ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const o of allowedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(o)) throw new Error(`Configuration invalide : origine « ${o} » mal formée`);
  }
  return {
    host: e.KAE_HOST,
    port: e.KAE_PORT,
    allowedOrigins,
    dataDir,
    dbFile: path.join(dataDir, 'keep-an-eye.db'),
    claudeBoxDir,
    workspaceDir: e.KAE_WORKSPACE_DIR ? resolvePath(e.KAE_WORKSPACE_DIR) : path.join(claudeBoxDir, 'workspace'),
    eventsFile: e.KAE_EVENTS_FILE ? resolvePath(e.KAE_EVENTS_FILE) : path.join(claudeBoxDir, 'events', 'claude.jsonl'),
    claudeHomeDir: e.KAE_CLAUDE_HOME_DIR ? resolvePath(e.KAE_CLAUDE_HOME_DIR) : path.join(claudeBoxDir, 'claude-home'),
    templatesFile: resolvePath(e.KAE_TEMPLATES_FILE),
    tmuxBin: e.KAE_TMUX_BIN,
    tmuxSocket: e.KAE_TMUX_SOCKET,
    dockerBin: e.KAE_DOCKER_BIN,
    hostLabel: e.KAE_HOST_LABEL ?? hostname(),
    shell: e.KAE_SHELL ?? env.SHELL ?? '/bin/bash',
    cookieSecure: e.KAE_COOKIE_SECURE,
    vapidSubject: e.KAE_VAPID_SUBJECT,
    webDist: resolvePath(e.KAE_WEB_DIST),
    logLevel: e.KAE_LOG_LEVEL,
  };
}
