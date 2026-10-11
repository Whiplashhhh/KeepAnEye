import { appendFileSync } from 'node:fs';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { setAdmin } from '../src/auth/admin.js';
import { hashPassword } from '../src/auth/password.js';
import { DEFAULT_RATE_LIMIT } from '../src/auth/rateLimit.js';
import { regenerateRecoveryCodes } from '../src/auth/recovery.js';
import { generateTotpSecret, totpAt } from '../src/auth/totp.js';
import type { DB } from '../src/db.js';
import { FakeTmuxClient } from '../src/tmux/fake.js';
import { memDb, ORIGIN, testConfig } from './helpers.js';

const PASSWORD = 'correct horse battery staple';
let passwordHash: string;

let app: App;
let db: DB;
let tmux: FakeTmuxClient;
let secret: string;
let recovery: string[];
let config: ReturnType<typeof testConfig>;

beforeEach(async () => {
  passwordHash ??= await hashPassword(PASSWORD);
  db = memDb();
  secret = generateTotpSecret();
  setAdmin(db, passwordHash, secret, Date.now());
  recovery = regenerateRecoveryCodes(db);
  tmux = new FakeTmuxClient();
  config = testConfig();
  app = await buildApp({
    config,
    db,
    tmux,
    containerProbe: { status: async () => ({ state: 'running', detail: 'Up 2 hours' }) },
    pushSender: { send: async () => undefined },
    loginDelayMs: 0,
    background: false,
    logger: false,
    rateLimit: { ...DEFAULT_RATE_LIMIT, ipThreshold: 5 },
  });
});

afterEach(async () => {
  await app.close();
});

function cookieFrom(res: LightMyRequestResponse, name: string): string | undefined {
  const c = res.cookies.find((x) => x.name === name);
  return c?.value;
}

async function post(url: string, body: unknown, cookies: Record<string, string> = {}, origin: string | null = ORIGIN) {
  return app.fastify.inject({
    method: 'POST',
    url,
    payload: body as object,
    cookies,
    headers: origin ? { origin } : {},
  });
}

async function login(): Promise<string> {
  const r1 = await post('/api/auth/password', { password: PASSWORD });
  expect(r1.statusCode).toBe(200);
  const pre = cookieFrom(r1, 'kae_pre')!;
  const r2 = await post('/api/auth/second-factor', { code: totpAt(secret, Date.now()) }, { kae_pre: pre });
  expect(r2.statusCode).toBe(200);
  return cookieFrom(r2, 'kae_sid')!;
}

describe('login flow', () => {
  it('password then TOTP yields a hardened session cookie', async () => {
    const r1 = await post('/api/auth/password', { password: PASSWORD });
    expect(r1.json()).toEqual({ next: 'second-factor' });
    const pre = r1.cookies.find((c) => c.name === 'kae_pre')!;
    expect(pre).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/auth' });

    const me = await app.fastify.inject({ url: '/api/auth/me', cookies: { kae_pre: pre.value } });
    expect(me.json()).toEqual({ authenticated: false, stage: 'second-factor' });

    const r2 = await post('/api/auth/second-factor', { code: totpAt(secret, Date.now()) }, { kae_pre: pre.value });
    expect(r2.statusCode).toBe(200);
    const sid = r2.cookies.find((c) => c.name === 'kae_sid')!;
    expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(Buffer.from(sid.value, 'base64url')).toHaveLength(32);

    const me2 = await app.fastify.inject({ url: '/api/auth/me', cookies: { kae_sid: sid.value } });
    expect(me2.json()).toEqual({ authenticated: true, stage: 'done' });
    expect(app.audit.list().map((e) => e.event)).toEqual(['login.success', 'login.password_ok']);
  });

  it('wrong password: generic error, audited', async () => {
    const r = await post('/api/auth/password', { password: 'nope' });
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toBe('Identifiants incorrects.');
    expect(app.audit.list()[0]!.event).toBe('login.password_failed');
  });

  it('TOTP is never accepted without the password step', async () => {
    const r = await post('/api/auth/second-factor', { code: totpAt(secret, Date.now()) });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('preauth_expired');
  });

  it('a TOTP code cannot be replayed', async () => {
    const code = totpAt(secret, Date.now());
    const pre1 = cookieFrom(await post('/api/auth/password', { password: PASSWORD }), 'kae_pre')!;
    expect((await post('/api/auth/second-factor', { code }, { kae_pre: pre1 })).statusCode).toBe(200);
    const pre2 = cookieFrom(await post('/api/auth/password', { password: PASSWORD }), 'kae_pre')!;
    const replay = await post('/api/auth/second-factor', { code }, { kae_pre: pre2 });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error).toBe('invalid_credentials');
  });

  it('recovery code works once instead of TOTP', async () => {
    const pre = cookieFrom(await post('/api/auth/password', { password: PASSWORD }), 'kae_pre')!;
    const ok = await post('/api/auth/second-factor', { code: recovery[0] }, { kae_pre: pre });
    expect(ok.statusCode).toBe(200);
    const pre2 = cookieFrom(await post('/api/auth/password', { password: PASSWORD }), 'kae_pre')!;
    expect((await post('/api/auth/second-factor', { code: recovery[0] }, { kae_pre: pre2 })).statusCode).toBe(401);
    expect(app.audit.list().some((e) => e.event === 'login.recovery_code_used')).toBe(true);
  });

  it('locks out after repeated failures, even with the right password', async () => {
    for (let i = 0; i < 5; i++) await post('/api/auth/password', { password: 'bad' });
    const r = await post('/api/auth/password', { password: PASSWORD });
    expect(r.statusCode).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.json().message).toMatch(/Trop de tentatives/);
  });

  it('pads responses to a constant minimum delay', async () => {
    const slow = await buildApp({
      config,
      db: memDb(),
      tmux,
      containerProbe: { status: async () => ({ state: 'unknown', detail: '' }) },
      loginDelayMs: 300,
      background: false,
      logger: false,
    });
    const t0 = Date.now();
    await slow.fastify.inject({ method: 'POST', url: '/api/auth/password', payload: { password: 'x' }, headers: { origin: ORIGIN } });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
    await slow.close();
  });

  it('logout-all revokes every session', async () => {
    const a = await login();
    const b = await login().catch(() => null); // second code in the same period is a replay
    expect(b).toBeNull();
    const r = await post('/api/auth/logout-all', {}, { kae_sid: a });
    expect(r.json()).toMatchObject({ ok: true, closed: 1 });
    const after = await app.fastify.inject({ url: '/api/sessions', cookies: { kae_sid: a } });
    expect(after.statusCode).toBe(401);
  });
});

describe('request hardening', () => {
  it('API requires a session', async () => {
    for (const url of ['/api/sessions', '/api/host', '/api/audit', '/api/activity', '/api/templates', '/api/projects']) {
      const r = await app.fastify.inject({ url });
      expect(r.statusCode, url).toBe(401);
    }
  });

  it('state-changing requests need an allowed Origin', async () => {
    const sid = await login();
    const none = await post('/api/sessions', { name: 'x', template: 'terminal' }, { kae_sid: sid }, null);
    expect(none.statusCode).toBe(403);
    const evil = await post('/api/sessions', { name: 'x', template: 'terminal' }, { kae_sid: sid }, 'https://evil.example');
    expect(evil.statusCode).toBe(403);
    const login403 = await post('/api/auth/password', { password: PASSWORD }, {}, 'https://evil.example');
    expect(login403.statusCode).toBe(403);
  });

  it('sends strict security headers', async () => {
    const r = await app.fastify.inject({ url: '/api/health' });
    const csp = String(r.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('sessions API', () => {
  it('creates, lists and closes sessions through tmux', async () => {
    const sid = await login();
    const created = await post('/api/sessions', { name: 'shell-1', template: 'terminal' }, { kae_sid: sid });
    expect(created.statusCode).toBe(200);
    tmux.write('shell-1', '$ ls', 'README.md  src', '');
    const list = (await app.fastify.inject({ url: '/api/sessions', cookies: { kae_sid: sid } })).json();
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0]).toMatchObject({ name: 'shell-1', kind: 'terminal', preview: ['$ ls', 'README.md  src'], claude: null });

    const dup = await post('/api/sessions', { name: 'shell-1', template: 'terminal' }, { kae_sid: sid });
    expect(dup.statusCode).toBe(409);

    const del = await app.fastify.inject({ method: 'DELETE', url: '/api/sessions/shell-1', cookies: { kae_sid: sid }, headers: { origin: ORIGIN } });
    expect(del.statusCode).toBe(200);
    expect(tmux.sessions.size).toBe(0);
    const events = app.audit.list().map((e) => e.event);
    expect(events).toContain('session.created');
    expect(events).toContain('session.closed');
  });

  it('launches Claude in claude-box with the exact docker command', async () => {
    const sid = await login();
    const r = await post('/api/sessions', { name: 'web', template: 'claude', project: 'webapp', flags: ['autonomous'] }, { kae_sid: sid });
    expect(r.statusCode).toBe(200);
    const { opts } = tmux.created[0]!;
    expect(opts.command).toEqual([
      'docker', 'compose', '-f', `${config.claudeBoxDir}/compose.yml`, 'exec', '-u', 'claude', '-w', '/workspace/webapp',
      '-e', 'KEEP_AN_EYE_SESSION=web', 'claude', 'claude', '--dangerously-skip-permissions',
    ]);
    expect(opts.userOptions).toMatchObject({ '@kae_kind': 'claude', '@kae_project': 'webapp' });
  });

  it('refuses unknown projects, bad names and unknown templates', async () => {
    const sid = await login();
    const cases = [
      { name: 'web', template: 'claude', project: '../../etc' },
      { name: 'web', template: 'claude', project: 'nope' },
      { name: 'web', template: 'claude' },
      { name: 'bad name', template: 'terminal' },
      { name: 'x;reboot', template: 'terminal' },
      { name: 'ok', template: 'missing' },
      { name: 'ok', template: 'claude', project: 'webapp', flags: ['--rm'] },
    ];
    for (const c of cases) {
      const r = await post('/api/sessions', c, { kae_sid: sid });
      expect(r.statusCode, JSON.stringify(c)).toBe(400);
      expect(r.json().message).toBeTruthy();
    }
    expect(tmux.created).toHaveLength(0);
    const del = await app.fastify.inject({ method: 'DELETE', url: '/api/sessions/a%20b', cookies: { kae_sid: sid }, headers: { origin: ORIGIN } });
    expect(del.statusCode).toBe(400);
  });

  it('derives Claude status from the events file', async () => {
    const sid = await login();
    await post('/api/sessions', { name: 'web', template: 'claude', project: 'webapp' }, { kae_sid: sid });
    const now = Date.now() / 1000;
    appendFileSync(
      config.eventsFile,
      `${JSON.stringify({ KEEP_AN_EYE_SESSION: 'web', hook_event_name: 'UserPromptSubmit', prompt: 'Corrige les tests', ts: now })}\n` +
        `${JSON.stringify({ KEEP_AN_EYE_SESSION: 'web', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', ts: now })}\n`,
    );
    app.watcher.poll();
    const s = (await app.fastify.inject({ url: '/api/sessions', cookies: { kae_sid: sid } })).json().sessions[0];
    expect(s.claude).toMatchObject({ status: 'waiting', lastMessage: 'Claude needs your permission to use Bash' });
    const act = (await app.fastify.inject({ url: '/api/activity', cookies: { kae_sid: sid } })).json().items;
    expect(act.map((a: { status: string }) => a.status)).toEqual(['waiting', 'working']);
  });

  it('lists projects and templates', async () => {
    const sid = await login();
    const p = (await app.fastify.inject({ url: '/api/projects', cookies: { kae_sid: sid } })).json();
    expect(p.projects).toEqual(['api', 'webapp']);
    const t = (await app.fastify.inject({ url: '/api/templates', cookies: { kae_sid: sid } })).json();
    expect(t.templates.map((x: { id: string }) => x.id)).toEqual(['terminal', 'claude']);
    expect(JSON.stringify(t)).not.toContain('docker'); // commands stay server-side
  });

  it('validates notification settings', async () => {
    const sid = await login();
    const put = (body: unknown) =>
      app.fastify.inject({ method: 'PUT', url: '/api/settings/notifications', payload: body as object, cookies: { kae_sid: sid }, headers: { origin: ORIGIN } });
    expect((await put({ types: { waiting: true, done: false, error: true }, dnd: { enabled: true, start: '23:00', end: '07:00' } })).statusCode).toBe(200);
    expect((await put({ types: { waiting: true }, dnd: {} })).statusCode).toBe(400);
    expect((await put({ types: { waiting: true, done: true, error: true }, dnd: { enabled: true, start: '25:00', end: '07:00' } })).statusCode).toBe(400);
  });
});
