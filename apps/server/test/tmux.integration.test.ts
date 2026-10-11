import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { setAdmin } from '../src/auth/admin.js';
import { hashPassword } from '../src/auth/password.js';
import { generateTotpSecret, totpAt } from '../src/auth/totp.js';
import { RealTmuxClient } from '../src/tmux/client.js';
import { memDb, ORIGIN, testConfig } from './helpers.js';

function hasTmux(): boolean {
  try {
    execFileSync('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

const SOCKET = `kae-vitest-${process.pid}`;
const tmux = new RealTmuxClient('tmux', SOCKET);

describe.skipIf(!hasTmux())('real tmux', () => {
  let app: App;
  let base: string;
  let sid: string;

  beforeAll(async () => {
    const db = memDb();
    const secret = generateTotpSecret();
    setAdmin(db, await hashPassword('integration-password'), secret, Date.now());
    app = await buildApp({
      config: testConfig({ tmuxSocket: SOCKET }),
      db,
      tmux,
      containerProbe: { status: async () => ({ state: 'unknown', detail: '' }) },
      loginDelayMs: 0,
      background: false,
      logger: false,
    });
    await app.fastify.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.fastify.server.address() as { port: number };
    base = `127.0.0.1:${addr.port}`;
    const r1 = await app.fastify.inject({ method: 'POST', url: '/api/auth/password', payload: { password: 'integration-password' }, headers: { origin: ORIGIN } });
    const pre = r1.cookies.find((c) => c.name === 'kae_pre')!.value;
    const r2 = await app.fastify.inject({ method: 'POST', url: '/api/auth/second-factor', payload: { code: totpAt(secret, Date.now()) }, cookies: { kae_pre: pre }, headers: { origin: ORIGIN } });
    sid = r2.cookies.find((c) => c.name === 'kae_sid')!.value;
  });

  afterAll(async () => {
    await app?.close();
    try {
      execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  });

  it('returns an empty list when no tmux server runs', async () => {
    expect(await tmux.listSessions()).toEqual([]);
  });

  it('creates a session with metadata, captures its output and kills it', async () => {
    await tmux.newSession('it-one', {
      cwd: '/tmp',
      command: ['bash', '-c', 'printf "hello %s\\n" "$1"; sleep 30', '_', '$(whoami); echo pwned'],
      userOptions: { '@kae_kind': 'claude', '@kae_project': 'webapp' },
    });
    await new Promise((r) => setTimeout(r, 400));
    const [s] = await tmux.listSessions();
    expect(s).toMatchObject({ name: 'it-one', kind: 'claude', project: 'webapp' });
    expect(s!.windows[0]).toMatchObject({ index: 0, active: true });
    // Arguments are passed verbatim: no shell expansion anywhere.
    const lines = await tmux.capturePane('it-one', 10);
    expect(lines.join('\n')).toContain('hello $(whoami); echo pwned');
    expect(await tmux.hasSession('it-one')).toBe(true);
    expect(await tmux.hasSession('it')).toBe(false); // exact match, no prefix matching
    await tmux.killSession('it-one');
    expect(await tmux.hasSession('it-one')).toBe(false);
  });

  it('refuses WebSockets without a session or with a bad Origin', async () => {
    const tryOpen = (headers: Record<string, string>) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`ws://${base}/ws/live`, { headers });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('open', () => {
          ws.close();
          resolve(101);
        });
        ws.on('error', () => undefined);
      });
    expect(await tryOpen({ origin: ORIGIN })).toBe(401);
    expect(await tryOpen({ origin: 'https://evil.example', cookie: `kae_sid=${sid}` })).toBe(403);
    expect(await tryOpen({ cookie: `kae_sid=${sid}` })).toBe(403);
    expect(await tryOpen({ origin: ORIGIN, cookie: `kae_sid=${sid}` })).toBe(101);
  });

  it('streams the live session list', async () => {
    await tmux.newSession('it-live', { cwd: '/tmp', command: [] });
    const ws = new WebSocket(`ws://${base}/ws/live`, { headers: { origin: ORIGIN, cookie: `kae_sid=${sid}` } });
    const msg = await new Promise<{ type: string; sessions: { name: string }[] }>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        // The first snapshot may be the cached one; the forced refresh follows right after.
        if (m.type === 'sessions' && m.sessions.some((x: { name: string }) => x.name === 'it-live')) resolve(m);
      });
    });
    expect(msg.sessions.map((s) => s.name)).toContain('it-live');
    ws.close();
    await tmux.killSession('it-live');
  });

  it('attaches a terminal: input, output, resize, and detach leaves the session alive', async () => {
    await tmux.newSession('it-term', { cwd: '/tmp', command: ['bash', '--norc', '--noprofile'] });
    const open = () => new WebSocket(`ws://${base}/ws/term/it-term?cols=100&rows=30`, { headers: { origin: ORIGIN, cookie: `kae_sid=${sid}` } });
    const ws1 = open();
    const ws2 = open(); // a second device on the same session
    let out1 = '';
    let out2 = '';
    ws1.on('message', (d, bin) => bin && (out1 += d.toString()));
    ws2.on('message', (d, bin) => bin && (out2 += d.toString()));
    await Promise.all([ws1, ws2].map((w) => new Promise((r) => w.on('open', r))));
    await new Promise((r) => setTimeout(r, 300));
    ws1.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    ws1.send(JSON.stringify({ type: 'input', data: 'echo KAE_$((40+2))\r' }));
    await expect.poll(() => out1.includes('KAE_42'), { timeout: 5000 }).toBe(true);
    await expect.poll(() => out2.includes('KAE_42'), { timeout: 5000 }).toBe(true);
    // Garbage messages are ignored, not fatal.
    ws1.send('not json');
    ws1.send(JSON.stringify({ type: 'resize', cols: 1e9, rows: -1 }));
    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(await tmux.hasSession('it-term')).toBe(true);
    await tmux.killSession('it-term');
  });

  it('refuses a terminal for a session that does not exist', async () => {
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://${base}/ws/term/ghost`, { headers: { origin: ORIGIN, cookie: `kae_sid=${sid}` } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => undefined);
    });
    expect(code).toBe(404);
  });
});
