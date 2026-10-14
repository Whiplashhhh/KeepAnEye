/**
 * Starts a self-contained Keep An Eye instance for Playwright: temp data dir, dedicated tmux socket,
 * known admin credentials and (in demo mode) realistic data for the screenshots.
 *
 *   KAE_E2E_MODE=e2e|demo KAE_E2E_PORT=7791 tsx e2e/start-server.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../apps/server/src/app.js';
import { setAdmin } from '../apps/server/src/auth/admin.js';
import { hashPassword } from '../apps/server/src/auth/password.js';
import { regenerateRecoveryCodes } from '../apps/server/src/auth/recovery.js';
import { SessionStore } from '../apps/server/src/auth/sessions.js';
import { REPO_ROOT } from '../apps/server/src/config.js';
import type { Config } from '../apps/server/src/config.js';
import { openDb } from '../apps/server/src/db.js';
import { RealTmuxClient } from '../apps/server/src/tmux/client.js';
import { PROMPT_DIR, SCREENS } from './demo/screens.js';

export const E2E_PASSWORD = 'e2e-password-correct-horse';
export const E2E_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

const mode = process.env.KAE_E2E_MODE === 'demo' ? 'demo' : 'e2e';
const port = Number(process.env.KAE_E2E_PORT ?? (mode === 'demo' ? 7792 : 7791));
const socket = `kae-${mode}-${port}`;
const root = path.join(REPO_ROOT, '.e2e', mode);
const webDist = path.join(REPO_ROOT, 'apps/web/dist');

if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error('apps/web/dist is missing: run "npm run build -w @kae/web" first.');
  process.exit(1);
}

function tmux(...args: string[]) {
  return execFileSync('tmux', ['-L', socket, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
try {
  tmux('kill-server');
} catch {
  // not running
}

rmSync(root, { recursive: true, force: true });
const claudeBoxDir = path.join(root, 'claude-box');
const workspaceDir = path.join(claudeBoxDir, 'workspace');
const claudeHome = path.join(claudeBoxDir, 'claude-home');
const eventsFile = path.join(claudeBoxDir, 'events', 'claude.jsonl');
const projects = mode === 'demo' ? ['billing-api', 'docs-site', 'dotfiles', 'scraper', 'webapp'] : ['alpha', 'beta'];
for (const p of projects) mkdirSync(path.join(workspaceDir, p), { recursive: true });
mkdirSync(path.dirname(eventsFile), { recursive: true });
writeFileSync(eventsFile, '');
// A throwaway home: the folder picker starts there and the e2e tests create folders in it.
process.env.HOME = path.join(root, 'home');
mkdirSync(path.join(process.env.HOME, 'documents'), { recursive: true });

// No real ssh in e2e: a stand-in that shows its arguments, so the SSH template can be exercised end to end.
if (mode === 'e2e') {
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\necho "fake-ssh: $*"\nexec cat\n', { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
}

const origin = `http://localhost:${port}`;
const config: Config = {
  host: '127.0.0.1',
  port,
  allowedOrigins: [origin, `http://127.0.0.1:${port}`],
  dataDir: path.join(root, 'data'),
  dbFile: path.join(root, 'data', 'kae.db'),
  claudeBoxDir,
  workspaceDir,
  eventsFile,
  claudeHomeDir: claudeHome,
  templatesFile: path.join(REPO_ROOT, 'config/templates.json'),
  tmuxBin: 'tmux',
  tmuxRequireServer: false,
  tmuxSocket: socket,
  dockerBin: 'docker',
  hostLabel: mode === 'demo' ? 'homelab' : 'e2e-host',
  shell: '/bin/bash',
  cookieSecure: true,
  vapidSubject: 'mailto:e2e@localhost',
  webDist,
  logLevel: 'warn',
};

const db = openDb(config.dbFile);
setAdmin(db, await hashPassword(E2E_PASSWORD), E2E_TOTP_SECRET, Date.now());
const recovery = regenerateRecoveryCodes(db);
// A pre-made session for specs that don't test the login itself (TOTP codes are single-use).
const sessionToken = new SessionStore(db).create({ ip: '127.0.0.1', userAgent: 'playwright' });

if (mode === 'demo') await seedDemo();

const app = await buildApp({
  config,
  db,
  tmux: new RealTmuxClient('tmux', socket),
  containerProbe: { status: async () => ({ state: 'running', detail: 'Up 3 days (healthy)' }) },
  loginDelayMs: 150,
  logger: true,
});
await app.fastify.listen({ host: '127.0.0.1', port });
writeFileSync(path.join(root, 'state.json'), JSON.stringify({ origin, sessionToken, recovery, socket }));
console.log(`[${mode}] Keep An Eye on ${origin} (tmux socket ${socket})`);

const shutdown = async () => {
  await app.close();
  try {
    tmux('kill-server');
  } catch {
    // ignore
  }
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

// ---------------------------------------------------------------------------

async function seedDemo() {
  const now = Date.now();
  const min = 60_000;
  const screensDir = path.join(root, 'screens');
  mkdirSync(screensDir, { recursive: true });

  const sessions: { name: string; kind: 'claude' | 'terminal'; project?: string }[] = [
    { name: 'webapp', kind: 'claude', project: 'webapp' },
    { name: 'api-refactor', kind: 'claude', project: 'billing-api' },
    { name: 'docs-site', kind: 'claude', project: 'docs-site' },
    { name: 'scraper', kind: 'claude', project: 'scraper' },
    { name: 'infra', kind: 'terminal' },
    { name: 'shell-1', kind: 'terminal' },
  ];
  for (const s of sessions) {
    const file = path.join(screensDir, `${s.name}.txt`);
    let screen = SCREENS[s.name] ?? '';
    const isShell = s.kind === 'terminal';
    if (isShell) screen = screen.slice(0, screen.lastIndexOf('\r\n')); // bash prints the final prompt itself
    writeFileSync(file, `${screen}\r\n`);
    const dir = PROMPT_DIR[s.name] ?? '~';
    const ps1 = `\\[\\e[32m\\]moi@homelab\\[\\e[0m\\]:\\[\\e[36m\\]${dir}\\[\\e[0m\\]$ `;
    const cmd = isShell
      ? ['bash', '-c', 'cat "$1"; exec env PS1="$2" bash --norc --noprofile', '_', file, ps1]
      : ['bash', '-c', 'cat "$1"; exec sleep 86400', '_', file];
    tmux('new-session', '-d', '-s', s.name, '-x', '96', '-y', '32', '-c', root, '--', ...cmd);
    if (s === sessions[0]) {
      // A tuned, discreet status bar, as on a real setup.
      tmux('set-option', '-g', 'status-style', 'bg=default,fg=colour244');
      tmux('set-option', '-g', 'status-left', ' #S ');
      tmux('set-option', '-g', 'status-right', ' %H:%M ');
      tmux('set-option', '-g', 'window-status-current-format', '');
      tmux('set-option', '-g', 'window-status-format', '');
    }
    tmux('set-option', '-t', `=${s.name}:`, '@kae_kind', s.kind);
    if (s.project) tmux('set-option', '-t', `=${s.name}:`, '@kae_project', s.project);
  }

  // Transcripts (read by the timeline) and hook events (statuses + activity feed).
  const tDir = path.join(claudeHome, '.claude', 'projects', '-workspace-billing-api');
  mkdirSync(tDir, { recursive: true });
  const transcript = (name: string) => `/home/claude/.claude/projects/-workspace-${name}/${name}-session.jsonl`;
  const iso = (t: number) => new Date(t).toISOString();
  const tline = (type: string, content: unknown, t: number) => JSON.stringify({ type, timestamp: iso(t), message: { role: type, content } });
  const t0 = now - 7 * min;
  const lines = [
    tline('user', 'Migre le module de facturation vers le nouveau client Stripe et mets à jour les tests.', t0),
    tline('assistant', [{ type: 'text', text: 'Je commence par lire le client actuel et les tests associés.' }], t0 + 20_000),
    tline('assistant', [{ type: 'tool_use', name: 'Read', input: { file_path: '/workspace/billing-api/src/billing/stripe-client.ts' } }], t0 + 25_000),
    tline('assistant', [{ type: 'tool_use', name: 'Read', input: { file_path: '/workspace/billing-api/test/billing/invoices.test.ts' } }], t0 + 31_000),
    tline('assistant', [{ type: 'tool_use', name: 'Grep', input: { pattern: 'createInvoice' } }], t0 + 40_000),
    tline(
      'assistant',
      [
        {
          type: 'text',
          text: "Le client utilise encore l'ancienne API `charges`. Je passe sur `paymentIntents`, en gardant la même signature publique pour ne rien casser côté appelants.",
        },
      ],
      t0 + 70_000,
    ),
    tline('assistant', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/workspace/billing-api/src/billing/stripe-client.ts' } }], t0 + 140_000),
    tline('assistant', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/workspace/billing-api/src/billing/webhooks.ts' } }], t0 + 190_000),
    tline('assistant', [{ type: 'tool_use', name: 'Edit', input: { file_path: '/workspace/billing-api/test/billing/invoices.test.ts' } }], t0 + 240_000),
    tline('assistant', [{ type: 'text', text: 'Le client est migré. Je lance la suite de tests pour vérifier.' }], t0 + 290_000),
    tline('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'npm run test -- billing', description: 'Run the billing test suite' } }], t0 + 300_000),
  ];
  writeFileSync(path.join(tDir, 'billing-api-session.jsonl'), `${lines.join('\n')}\n`);

  const ev = (session: string, hook: string, t: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ KEEP_AN_EYE_SESSION: session, hook_event_name: hook, ts: t / 1000, session_id: `${session}-id`, ...extra });
  const events = [
    // yesterday
    ev('docs-site', 'SessionStart', now - 26 * 60 * min, { cwd: '/workspace/docs-site' }),
    ev('docs-site', 'UserPromptSubmit', now - 26 * 60 * min + min, { prompt: 'Réorganise la navigation de la doc par thème.' }),
    ev('docs-site', 'Stop', now - 25 * 60 * min),
    // today
    ev('scraper', 'SessionStart', now - 95 * min, { cwd: '/workspace/scraper' }),
    ev('scraper', 'UserPromptSubmit', now - 94 * min, { prompt: "Relance l'extraction des prix sur les 3 nouveaux sites." }),
    ev('scraper', 'PreToolUse', now - 92 * min, { tool_name: 'Bash', tool_input: { command: 'python -m scraper run --sites new' } }),
    ev('scraper', 'StopFailure', now - 71 * min, { error: 'API Error: 529 overloaded_error' }),
    ev('docs-site', 'UserPromptSubmit', now - 48 * min, { prompt: 'Ajoute une page « Installation » avec les étapes Ubuntu.' }),
    ev('docs-site', 'PreToolUse', now - 46 * min, { tool_name: 'Write', tool_input: { file_path: '/workspace/docs-site/content/install.md' } }),
    ev('docs-site', 'Stop', now - 41 * min),
    ev('api-refactor', 'SessionStart', now - 9 * min, { cwd: '/workspace/billing-api', transcript_path: transcript('billing-api') }),
    ev('api-refactor', 'UserPromptSubmit', now - 7 * min, {
      prompt: 'Migre le module de facturation vers le nouveau client Stripe et mets à jour les tests.',
      transcript_path: transcript('billing-api'),
    }),
    ev('api-refactor', 'PreToolUse', now - 5 * min, { tool_name: 'Edit', tool_input: { file_path: '/workspace/billing-api/src/billing/stripe-client.ts' } }),
    ev('api-refactor', 'Notification', now - 2 * min, {
      message: 'Claude needs your permission to use Bash',
      notification_type: 'permission_prompt',
    }),
    ev('webapp', 'SessionStart', now - 20 * min, { cwd: '/workspace/webapp' }),
    ev('webapp', 'UserPromptSubmit', now - 4 * min, { prompt: 'Le bouton « Payer » reste actif pendant la requête : corrige et ajoute un test.' }),
    ev('webapp', 'PreToolUse', now - 1 * min, { tool_name: 'Edit', tool_input: { file_path: '/workspace/webapp/src/components/Checkout.tsx' } }),
    ev('webapp', 'PreToolUse', now - 20_000, { tool_name: 'Write', tool_input: { file_path: '/workspace/webapp/src/components/Checkout.test.tsx' } }),
  ];
  writeFileSync(eventsFile, `${events.join('\n')}\n`);

  const audit = db.prepare('INSERT INTO audit_log (ts, event, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?)');
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const desktop = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  const rows: [number, string, string, string, unknown][] = [
    [now - 30 * 60 * min, 'admin.init', 'cli', '', null],
    [now - 29 * 60 * min, 'login.password_ok', '100.101.12.4', desktop, null],
    [now - 29 * 60 * min + 5000, 'login.success', '100.101.12.4', desktop, { method: 'totp' }],
    [now - 27 * 60 * min, 'session.created', '100.101.12.4', desktop, { name: 'docs-site' }],
    [now - 3 * 60 * min, 'login.password_failed', '100.88.3.17', iphone, null],
    [now - 3 * 60 * min + 9000, 'login.password_ok', '100.88.3.17', iphone, null],
    [now - 3 * 60 * min + 15000, 'login.success', '100.88.3.17', iphone, { method: 'totp' }],
    [now - 96 * min, 'session.created', '100.88.3.17', iphone, { name: 'scraper' }],
    [now - 22 * min, 'session.created', '100.101.12.4', desktop, { name: 'webapp' }],
    [now - 10 * min, 'session.created', '100.101.12.4', desktop, { name: 'api-refactor' }],
    [now - 8 * min, 'session.closed', '100.101.12.4', desktop, { name: 'tmp-test' }],
    [now - 3 * min, 'terminal.opened', '100.88.3.17', iphone, { name: 'api-refactor' }],
  ];
  for (const [ts, event, ip, ua, detail] of rows) audit.run(ts, event, ip, ua || null, detail ? JSON.stringify(detail) : null);
}
