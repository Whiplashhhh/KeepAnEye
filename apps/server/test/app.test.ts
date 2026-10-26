import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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
let clones: Array<{ repo: string; project: string }>;
let cloneError: string | null;

beforeEach(async () => {
  passwordHash ??= await hashPassword(PASSWORD);
  db = memDb();
  secret = generateTotpSecret();
  setAdmin(db, passwordHash, secret, Date.now());
  recovery = regenerateRecoveryCodes(db);
  tmux = new FakeTmuxClient();
  config = testConfig();
  clones = [];
  cloneError = null;
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
    cloner: {
      clone: async (repo, project) => {
        if (cloneError) throw new Error(cloneError);
        clones.push({ repo, project });
        mkdirSync(path.join(config.workspaceDir, project));
      },
    },
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

  it('odd URL spellings never reach the API without a session', async () => {
    for (const url of ['//api/sessions', '/api//sessions', '/api/sessions/', '/api/%73essions', '/API/sessions', '/api/health/../sessions', '/api/nope']) {
      const r = await app.fastify.inject({ url });
      expect(r.statusCode === 401 || r.statusCode === 404 || !r.body.includes('"sessions"'), url).toBe(true);
      expect(r.body, url).not.toContain('"sessions":[');
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

  it('renames a session and keeps its Claude state', async () => {
    const sid = await login();
    const patch = (url: string, payload: unknown) =>
      app.fastify.inject({ method: 'PATCH', url, payload: payload as object, cookies: { kae_sid: sid }, headers: { origin: ORIGIN } });
    await post('/api/sessions', { name: 'old-name', template: 'terminal' }, { kae_sid: sid });
    await post('/api/sessions', { name: 'other', template: 'terminal' }, { kae_sid: sid });

    expect((await patch('/api/sessions/old-name', { name: 'other' })).statusCode).toBe(409);
    expect((await patch('/api/sessions/old-name', { name: 'bad name' })).statusCode).toBe(400);
    expect((await patch('/api/sessions/ghost', { name: 'new-name' })).statusCode).toBe(404);

    app.tracker.apply({ session: 'old-name', hook: 'UserPromptSubmit', ts: Date.now(), prompt: 'hi' } as never);
    const ok = await patch('/api/sessions/old-name', { name: 'new-name' });
    expect(ok.statusCode).toBe(200);
    expect(tmux.sessions.has('old-name')).toBe(false);
    expect(tmux.sessions.has('new-name')).toBe(true);
    expect(app.tracker.get('new-name')).not.toBeNull();
    expect(app.tracker.get('old-name')).toBeNull();
    expect(app.tracker.resolve('old-name')).toBe('new-name');
    expect(app.audit.list().map((e) => e.event)).toContain('session.renamed');
  });

  it('stores a pasted image and returns the path the session can read', async () => {
    const sid = await login();
    await post('/api/sessions', { name: 'shell-1', template: 'terminal' }, { kae_sid: sid });
    await post('/api/sessions', { name: 'web', template: 'claude', project: 'webapp' }, { kae_sid: sid });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const upload = (name: string, body: Buffer, type = 'image/png', cookies: Record<string, string> = { kae_sid: sid }) =>
      app.fastify.inject({ method: 'POST', url: `/api/sessions/${name}/upload`, payload: body, cookies, headers: { origin: ORIGIN, 'content-type': type } });

    const host = await upload('shell-1', png);
    expect(host.statusCode).toBe(200);
    const hostPath = host.json().path as string;
    expect(hostPath).toMatch(new RegExp(`^${config.workspaceDir}/\\.kae-uploads/paste-.*\\.png$`));
    expect(readFileSync(hostPath)).toEqual(png);

    const claude = await upload('web', png);
    expect(claude.json().path).toMatch(/^\/workspace\/\.kae-uploads\/paste-.*\.png$/);

    expect((await upload('shell-1', Buffer.from('not an image at all'))).statusCode).toBe(400);
    expect((await upload('shell-1', png, 'text/plain')).statusCode).toBe(400);
    expect((await upload('nope', png)).statusCode).toBe(404);
    expect((await upload('shell-1', png, 'image/png', {})).statusCode).toBe(401);
    expect(app.audit.list().map((e) => e.event)).toContain('session.upload');
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

  it('passes the chosen model and thinking effort to Claude', async () => {
    const sid = await login();
    const r = await post('/api/sessions', { name: 'web', template: 'claude', project: 'webapp', model: 'sonnet', effort: 'max' }, { kae_sid: sid });
    expect(r.statusCode).toBe(200);
    expect(tmux.created[0]!.opts.command!.slice(-5)).toEqual(['claude', '--model', 'sonnet', '--effort', 'max']);
    const bad = await post('/api/sessions', { name: 'web2', template: 'claude', project: 'webapp', model: 'nope' }, { kae_sid: sid });
    expect(bad.statusCode).toBe(400);
  });

  it('opens a terminal in a chosen folder, never for templates that do not allow it', async () => {
    const sid = await login();
    const dir = path.join(config.workspaceDir, 'webapp');
    const r = await post('/api/sessions', { name: 'here', template: 'terminal', cwd: `${dir}/` }, { kae_sid: sid });
    expect(r.statusCode).toBe(200);
    expect(tmux.created[0]!.opts.cwd).toBe(dir);
    const cases = [
      { name: 'a', template: 'terminal', cwd: 'relative/dir' },
      { name: 'b', template: 'terminal', cwd: path.join(dir, 'missing') },
      { name: 'c', template: 'terminal', cwd: config.templatesFile },
      { name: 'd', template: 'claude', project: 'webapp', cwd: dir },
    ];
    for (const c of cases) expect((await post('/api/sessions', c, { kae_sid: sid })).statusCode, JSON.stringify(c)).toBe(400);
    expect(tmux.created).toHaveLength(1);
  });

  describe('SSH machines', () => {
    const send = (method: 'PUT' | 'DELETE', url: string, sid: string, payload?: object) =>
      app.fastify.inject({ method, url, payload, cookies: { kae_sid: sid }, headers: { origin: ORIGIN } });

    it('needs a session and an allowed origin', async () => {
      const sid = await login();
      expect((await app.fastify.inject({ url: '/api/ssh-hosts' })).statusCode).toBe(401);
      expect((await post('/api/ssh-hosts', { name: 'vps', host: 'vps.example.com' }, { kae_sid: sid }, null)).statusCode).toBe(403);
    });

    it('saves, lists, edits and deletes machines, and audits each change', async () => {
      const sid = await login();
      const created = await post('/api/ssh-hosts', { name: 'VPS', host: 'vps.example.com', user: 'root', port: 2222 }, { kae_sid: sid });
      expect(created.statusCode).toBe(200);
      const host = created.json().host;
      expect(host).toMatchObject({ name: 'VPS', host: 'vps.example.com', port: 2222, user: 'root', identityFile: null });
      expect((await post('/api/ssh-hosts', { name: 'vps', host: 'other.example.com' }, { kae_sid: sid })).statusCode).toBe(409);

      const edited = await send('PUT', `/api/ssh-hosts/${host.id}`, sid, { name: 'VPS', host: '203.0.113.7', identityFile: '/home/me/.ssh/id_vps' });
      expect(edited.json().host).toMatchObject({ host: '203.0.113.7', port: 22, user: null, identityFile: '/home/me/.ssh/id_vps' });
      expect((await send('PUT', '/api/ssh-hosts/999', sid, { name: 'x', host: 'x.example.com' })).statusCode).toBe(404);

      const list = await app.fastify.inject({ url: '/api/ssh-hosts', cookies: { kae_sid: sid } });
      expect(list.json().hosts).toHaveLength(1);
      expect((await send('DELETE', `/api/ssh-hosts/${host.id}`, sid)).statusCode).toBe(200);
      expect((await send('DELETE', `/api/ssh-hosts/${host.id}`, sid)).statusCode).toBe(404);
      expect(app.audit.list().map((e) => e.event)).toEqual(expect.arrayContaining(['ssh_host.created', 'ssh_host.updated', 'ssh_host.deleted']));
    });

    it('refuses values that ssh could read as options or that break out of the argument', async () => {
      const sid = await login();
      const bad = [
        { name: 'a', host: '-oProxyCommand=touch/tmp/pwned' },
        { name: 'a', host: 'host name' },
        { name: 'a', host: 'host;reboot' },
        { name: 'a', host: 'ok.example.com', user: '-oProxyCommand=x' },
        { name: 'a', host: 'ok.example.com', user: 'a b' },
        { name: 'a', host: 'ok.example.com', identityFile: '-oProxyCommand=x' },
        { name: 'a', host: 'ok.example.com', identityFile: 'relative/key' },
        { name: 'a', host: 'ok.example.com', port: 0 },
        { name: 'a', host: 'ok.example.com', port: 70000 },
        { name: '', host: 'ok.example.com' },
        { name: '<b>', host: 'ok.example.com' },
      ];
      for (const b of bad) expect((await post('/api/ssh-hosts', b, { kae_sid: sid })).statusCode, JSON.stringify(b)).toBe(400);
      expect((await app.fastify.inject({ url: '/api/ssh-hosts', cookies: { kae_sid: sid } })).json().hosts).toEqual([]);
    });

    it('opens a terminal on the machine with the exact ssh command', async () => {
      const sid = await login();
      const { id } = (await post('/api/ssh-hosts', { name: 'VPS', host: 'vps.example.com', user: 'root', port: 2222, identityFile: '/home/me/.ssh/id_vps' }, { kae_sid: sid })).json().host;
      const r = await post('/api/sessions', { name: 'vps', template: 'ssh', sshHost: id }, { kae_sid: sid });
      expect(r.statusCode).toBe(200);
      const { opts } = tmux.created[0]!;
      expect(opts.command).toEqual([
        'ssh', '-o', 'ServerAliveInterval=30', '-p', '2222', '-l', 'root', '-i', '/home/me/.ssh/id_vps', '-o', 'IdentitiesOnly=yes', '--', 'vps.example.com',
      ]);
      expect(opts.userOptions).toMatchObject({ '@kae_kind': 'terminal', '@kae_template': 'ssh', '@kae_ssh': 'VPS' });
      expect(opts.keepOnFailure).toBe(true);
      const sessions = (await app.fastify.inject({ url: '/api/sessions', cookies: { kae_sid: sid } })).json().sessions;
      expect(sessions[0]).toMatchObject({ name: 'vps', kind: 'terminal', sshHost: 'VPS' });
      expect(app.audit.list().find((e) => e.event === 'session.created')?.detail).toMatchObject({ sshHost: 'VPS' });
    });

    it('keeps the command minimal for a plain host and rejects wrong machine choices', async () => {
      const sid = await login();
      const { id } = (await post('/api/ssh-hosts', { name: 'pi', host: 'pi.local' }, { kae_sid: sid })).json().host;
      expect((await post('/api/sessions', { name: 'pi', template: 'ssh', sshHost: id }, { kae_sid: sid })).statusCode).toBe(200);
      expect(tmux.created[0]!.opts.command).toEqual(['ssh', '-o', 'ServerAliveInterval=30', '--', 'pi.local']);
      const cases = [
        { name: 'a', template: 'ssh' },
        { name: 'b', template: 'ssh', sshHost: 999 },
        { name: 'c', template: 'terminal', sshHost: id },
        { name: 'd', template: 'claude', project: 'webapp', sshHost: id },
      ];
      for (const c of cases) expect((await post('/api/sessions', c, { kae_sid: sid })).statusCode, JSON.stringify(c)).toBe(400);
      expect(tmux.created).toHaveLength(1);
    });
  });

  it('browses folders and creates new ones for the folder picker', async () => {
    const sid = await login();
    const ls = (p: string) => app.fastify.inject({ url: `/api/fs?path=${encodeURIComponent(p)}`, cookies: { kae_sid: sid } });
    mkdirSync(path.join(config.workspaceDir, '.hidden'));
    const root = (await ls(config.workspaceDir)).json();
    expect(root).toMatchObject({ path: config.workspaceDir, parent: config.claudeBoxDir, truncated: false });
    expect(root.entries).toEqual([
      { name: '.hidden', hidden: true },
      { name: 'api', hidden: false },
      { name: 'webapp', hidden: false },
    ]);
    expect((await ls('/')).json().parent).toBeNull();
    expect((await ls('relative')).statusCode).toBe(400);
    expect((await ls(path.join(config.workspaceDir, 'missing'))).statusCode).toBe(400);
    expect((await app.fastify.inject({ url: '/api/fs' })).statusCode).toBe(401);

    const made = await post('/api/fs/mkdir', { parent: config.workspaceDir, name: ' nouveau projet ' }, { kae_sid: sid });
    expect(made.statusCode).toBe(200);
    expect(made.json().path).toBe(path.join(config.workspaceDir, 'nouveau projet'));
    expect((await ls(config.workspaceDir)).json().entries.map((e: { name: string }) => e.name)).toContain('nouveau projet');
    expect((await post('/api/fs/mkdir', { parent: config.workspaceDir, name: 'nouveau projet' }, { kae_sid: sid })).statusCode).toBe(409);
    for (const name of ['..', '.', 'a/b', '  ']) {
      expect((await post('/api/fs/mkdir', { parent: config.workspaceDir, name }, { kae_sid: sid })).statusCode, name).toBe(400);
    }
    expect((await post('/api/fs/mkdir', { parent: config.workspaceDir, name: 'x' }, { kae_sid: sid }, null)).statusCode).toBe(403);
    expect(app.audit.list().map((e) => e.event)).toContain('fs.mkdir');
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

  it('clones a GitHub repo into the workspace before launching Claude on it', async () => {
    const sid = await login();
    const r = await post('/api/sessions', { name: 'edt', template: 'claude', repo: 'https://github.com/Whiplashhhh/EDT.git' }, { kae_sid: sid });
    expect(r.statusCode).toBe(200);
    expect(clones).toEqual([{ repo: 'Whiplashhhh/EDT', project: 'EDT' }]);
    const { opts } = tmux.created[0]!;
    expect(opts.command).toContain('/workspace/EDT');
    expect(opts.userOptions).toMatchObject({ '@kae_project': 'EDT' });
    const p = (await app.fastify.inject({ url: '/api/projects', cookies: { kae_sid: sid } })).json();
    expect(p.projects).toEqual(['api', 'EDT', 'webapp']);

    // Already there: reused without cloning again.
    const again = await post('/api/sessions', { name: 'edt-2', template: 'claude', repo: 'Whiplashhhh/EDT' }, { kae_sid: sid });
    expect(again.statusCode).toBe(200);
    expect(clones).toHaveLength(1);
  });

  it('reports bad repos and clone failures without creating a session', async () => {
    const sid = await login();
    for (const repo of ['EDT', '../etc', 'a/b c', 'owner/..', 'x/y;reboot']) {
      const r = await post('/api/sessions', { name: 'edt', template: 'claude', repo }, { kae_sid: sid });
      expect(r.statusCode, repo).toBe(400);
    }
    cloneError = 'GraphQL: Could not resolve to a Repository';
    const r = await post('/api/sessions', { name: 'edt', template: 'claude', repo: 'Whiplashhhh/nope' }, { kae_sid: sid });
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toContain('Could not resolve');
    expect(clones).toHaveLength(0);
    expect(tmux.created).toHaveLength(0);
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
    expect(t.templates.map((x: { id: string }) => x.id)).toEqual(['terminal', 'ssh', 'claude']);
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
