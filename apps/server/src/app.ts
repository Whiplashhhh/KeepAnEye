import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import {
  createSessionSchema,
  notificationSettingsSchema,
  passwordLoginSchema,
  pushSubscriptionSchema,
  SESSION_NAME_RE,
  secondFactorSchema,
} from '@kae/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify, { LogController } from 'fastify';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { z, ZodError } from 'zod';
import { AuditLog } from './audit.js';
import { isAdminReady } from './auth/admin.js';
import { isOriginAllowed, requiresOriginCheck } from './auth/origin.js';
import type { RateLimitOptions } from './auth/rateLimit.js';
import { LoginRateLimiter } from './auth/rateLimit.js';
import { AuthService } from './auth/service.js';
import { PREAUTH_COOKIE, PREAUTH_MS, SESSION_COOKIE, SESSION_MAX_MS, SessionStore } from './auth/sessions.js';
import { ClaudeTracker } from './claude/tracker.js';
import { readTimeline } from './claude/transcript.js';
import { EventsWatcher } from './claude/watcher.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import type { ContainerProbe } from './host/stats.js';
import { HostStats } from './host/stats.js';
import { parseCookieHeader } from './http/cookies.js';
import { HttpError } from './http/errors.js';
import { clientIp } from './http/ip.js';
import { registerSecurityHeaders } from './http/security.js';
import type { RepoCloner } from './projects.js';
import { ClaudeBoxCloner, listProjects } from './projects.js';
import { handleStatusChange } from './push/notifier.js';
import type { PushSender } from './push/service.js';
import { PushService } from './push/service.js';
import { LiveHub } from './realtime/hub.js';
import { SessionService } from './sessions.js';
import type { Template } from './templates.js';
import { loadTemplates, toTemplateInfo } from './templates.js';
import { bridgeTerminal } from './terminal.js';
import type { TmuxClient } from './tmux/client.js';
import { MAX_UPLOAD_BYTES, saveUpload, UPLOAD_CONTENT_TYPES, UPLOAD_DIR_NAME, UploadError } from './uploads.js';

export interface AppDeps {
  config: Config;
  db: DB;
  tmux: TmuxClient;
  containerProbe: ContainerProbe;
  pushSender?: PushSender;
  rateLimit?: RateLimitOptions;
  /** Minimum duration of every login response (constant time from the outside). */
  loginDelayMs?: number;
  /** Start the events watcher and periodic maintenance (off in unit tests). */
  background?: boolean;
  templates?: Template[];
  cloner?: RepoCloner;
  logger?: boolean;
}

export interface App {
  fastify: FastifyInstance;
  hub: LiveHub;
  tracker: ClaudeTracker;
  watcher: EventsWatcher;
  sessions: SessionStore;
  push: PushService;
  audit: AuditLog;
  close(): Promise<void>;
}

const LOOPBACK_PROXIES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

export async function buildApp(deps: AppDeps): Promise<App> {
  const { config, db, tmux } = deps;
  const loginDelayMs = deps.loginDelayMs ?? 800;

  const fastify = Fastify({
    logger: deps.logger === false ? false : { level: config.logLevel },
    // tailscale serve proxies from loopback: only then is X-Forwarded-For trusted.
    trustProxy: LOOPBACK_PROXIES,
    bodyLimit: 64 * 1024,
    // No per-request log lines: the audit log records what matters, journald stays readable.
    logController: new LogController({ disableRequestLogging: true }),
  });

  const audit = new AuditLog(db);
  const sessions = new SessionStore(db);
  const limiter = new LoginRateLimiter(deps.rateLimit);
  const auth = new AuthService(db, sessions, limiter, audit);
  const tracker = new ClaudeTracker(db);
  const push = new PushService(db, config.vapidSubject, deps.pushSender);
  let templates = deps.templates ?? loadTemplates(config.templatesFile);
  const getTemplates = () => templates;
  const sessionService = new SessionService(tmux, tracker, {
    templates: getTemplates,
    workspaceDir: config.workspaceDir,
    claudeBoxDir: config.claudeBoxDir,
    claudeHomeDir: config.claudeHomeDir,
    cloner: deps.cloner ?? new ClaudeBoxCloner(config.dockerBin, config.claudeBoxDir),
    checkCwd: !config.tmuxRequireServer,
  });
  const hostStats = new HostStats(deps.containerProbe, undefined, config.hostLabel);
  const hub = new LiveHub(sessionService, hostStats);
  const watcher = new EventsWatcher(db, { file: config.eventsFile }, (ev) => tracker.apply(ev));

  tracker.on('change', (change) => {
    if (change.activity) hub.broadcast({ type: 'activity', item: change.activity });
    void hub.refreshSessions();
    void handleStatusChange(push, change)?.catch(() => undefined);
  });

  await fastify.register(fastifyCookie);
  registerSecurityHeaders(fastify);

  const ctxOf = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] ?? null });

  const cookieOpts = (maxAgeMs: number, cookiePath = '/') => ({
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    path: cookiePath,
    maxAge: Math.floor(maxAgeMs / 1000),
  });

  // ---- Origin check on every state-changing request ----
  fastify.addHook('onRequest', async (req, reply) => {
    if (requiresOriginCheck(req.method) && !isOriginAllowed(req.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send({ error: 'bad_origin', message: 'Origine de la requête non autorisée.' });
    }
  });

  // ---- Authentication guard for the API ----
  const PUBLIC = new Set(['/api/health', '/api/auth/me', '/api/auth/password', '/api/auth/second-factor']);
  fastify.addHook('preHandler', async (req, reply) => {
    // Decide on the route that actually matched, not on the raw URL text (immune to odd encodings).
    const route = req.routeOptions.url ?? '';
    if (!route.startsWith('/api/') || PUBLIC.has(route)) return;
    if (!sessions.validate(req.cookies[SESSION_COOKIE])) {
      return reply.code(401).send({ error: 'unauthenticated', message: 'Session expirée, reconnecte-toi.' });
    }
  });

  fastify.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid_input', message: err.issues[0]?.message ?? 'Requête invalide.' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: 'Requête invalide.' });
    }
    fastify.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Erreur interne du serveur. Consulte les journaux.' });
  });

  /** Pads login responses to a constant minimum duration. */
  async function constantTime<T>(fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const left = loginDelayMs - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    }
  }

  /** Sets the status and returns the body: sent by Fastify only once the constant delay has elapsed. */
  function loginFailure(reply: FastifyReply, reason: 'invalid' | 'blocked' | 'expired', retryAfterMs?: number) {
    if (reason === 'blocked') {
      const seconds = Math.ceil((retryAfterMs ?? 60_000) / 1000);
      reply.code(429).header('Retry-After', String(seconds));
      const minutes = Math.ceil(seconds / 60);
      return { error: 'blocked', message: `Trop de tentatives. Réessaie dans ${minutes} minute${minutes > 1 ? 's' : ''}.` };
    }
    if (reason === 'expired') {
      reply.code(401);
      return { error: 'preauth_expired', message: 'Délai dépassé. Saisis à nouveau ton mot de passe.' };
    }
    reply.code(401);
    return { error: 'invalid_credentials', message: 'Identifiants incorrects.' };
  }

  // ---------------- Auth routes ----------------

  fastify.get('/api/health', async () => ({ ok: true }));

  fastify.get('/api/auth/me', async (req) => {
    if (sessions.validate(req.cookies[SESSION_COOKIE])) return { authenticated: true, stage: 'done' };
    if (sessions.validatePreauth(req.cookies[PREAUTH_COOKIE])) return { authenticated: false, stage: 'second-factor' };
    return { authenticated: false, stage: isAdminReady(db) ? 'password' : 'uninitialized' };
  });

  fastify.post('/api/auth/password', async (req, reply) =>
    constantTime(async () => {
      const body = passwordLoginSchema.safeParse(req.body);
      if (!body.success) return loginFailure(reply, 'invalid');
      const res = await auth.password(body.data.password, ctxOf(req));
      if (!res.ok) return loginFailure(reply, res.reason, res.retryAfterMs);
      reply.setCookie(PREAUTH_COOKIE, res.token, cookieOpts(PREAUTH_MS, '/api/auth'));
      return { next: 'second-factor' };
    }),
  );

  fastify.post('/api/auth/second-factor', async (req, reply) =>
    constantTime(async () => {
      const body = secondFactorSchema.safeParse(req.body);
      if (!body.success) return loginFailure(reply, 'invalid');
      const res = auth.secondFactor(req.cookies[PREAUTH_COOKIE], body.data.code, ctxOf(req));
      if (!res.ok) return loginFailure(reply, res.reason, res.retryAfterMs);
      reply.clearCookie(PREAUTH_COOKIE, { path: '/api/auth' });
      reply.setCookie(SESSION_COOKIE, res.token, cookieOpts(SESSION_MAX_MS));
      return { ok: true };
    }),
  );

  fastify.post('/api/auth/logout', async (req, reply) => {
    sessions.destroy(req.cookies[SESSION_COOKIE]);
    audit.record('logout', ctxOf(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  fastify.post('/api/auth/logout-all', async (req, reply) => {
    const n = sessions.destroyAll();
    audit.record('logout.all', ctxOf(req), { sessions: n });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    hub.closeAll(4401, 'logout-all');
    closeTerminals();
    return { ok: true, closed: n };
  });

  // ---------------- Sessions ----------------

  fastify.get('/api/sessions', async () => ({ sessions: await sessionService.list() }));

  fastify.post('/api/sessions', async (req) => {
    const input = createSessionSchema.parse(req.body);
    const res = await sessionService.create(input);
    audit.record('session.created', ctxOf(req), {
      name: input.name,
      template: input.template,
      project: input.project ?? null,
      repo: input.repo ?? null,
      flags: input.flags,
    });
    await hub.refreshSessions();
    return res;
  });

  const nameParam = z.object({ name: z.string().regex(SESSION_NAME_RE, 'Nom de session invalide') });

  fastify.delete('/api/sessions/:name', async (req) => {
    const { name } = nameParam.parse(req.params);
    await sessionService.close(name);
    audit.record('session.closed', ctxOf(req), { name });
    await hub.refreshSessions();
    return { ok: true };
  });

  // Pasted / dropped images: stored where the session can read them, the path is typed into the terminal.
  fastify.addContentTypeParser(UPLOAD_CONTENT_TYPES, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  fastify.post('/api/sessions/:name/upload', { bodyLimit: MAX_UPLOAD_BYTES }, async (req) => {
    const { name } = nameParam.parse(req.params);
    const session = (await sessionService.list()).find((s) => s.name === name);
    if (!session) throw new HttpError(404, 'not_found', 'Session introuvable.');
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'unsupported', 'Seules les images PNG, JPEG, GIF et WebP sont acceptées.');
    let file: string;
    try {
      file = await saveUpload(config.workspaceDir, type, req.body);
    } catch (e) {
      if (e instanceof UploadError) throw new HttpError(400, 'invalid_upload', e.message);
      throw e;
    }
    audit.record('session.upload', ctxOf(req), { name, file, bytes: req.body.length });
    // Claude runs inside claude-box, where the workspace is mounted at /workspace; a terminal runs on the host.
    const dir = session.kind === 'claude' ? `/workspace/${UPLOAD_DIR_NAME}` : path.join(config.workspaceDir, UPLOAD_DIR_NAME);
    return { path: `${dir}/${file}` };
  });

  fastify.get('/api/sessions/:name/timeline', async (req) => {
    const { name } = nameParam.parse(req.params);
    const state = tracker.get(name);
    return readTimeline(state?.transcriptPath ?? null, config.claudeHomeDir);
  });

  fastify.get('/api/templates', async () => {
    try {
      templates = deps.templates ?? loadTemplates(config.templatesFile); // pick up edits without restart
    } catch (e) {
      fastify.log.warn((e as Error).message);
    }
    return { templates: templates.map(toTemplateInfo) };
  });

  fastify.get('/api/projects', async () => ({ projects: await listProjects(config.workspaceDir) }));

  fastify.get('/api/host', async () => hostStats.read());

  const pageQuery = z.object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    before: z.coerce.number().int().positive().optional(),
  });

  fastify.get('/api/activity', async (req) => {
    const q = pageQuery.parse(req.query);
    return { items: tracker.activity(q.limit, q.before) };
  });

  fastify.get('/api/audit', async (req) => {
    const q = pageQuery.parse(req.query);
    return { entries: audit.list(q.limit, q.before) };
  });

  // ---------------- Notifications ----------------

  fastify.get('/api/settings/notifications', async () => ({ settings: push.getSettings(), devices: push.count() }));

  fastify.put('/api/settings/notifications', async (req) => {
    const s = notificationSettingsSchema.parse(req.body);
    push.setSettings(s);
    return { settings: s };
  });

  fastify.get('/api/push/key', async () => ({ publicKey: push.publicKey }));

  fastify.post('/api/push/subscribe', async (req) => {
    const sub = pushSubscriptionSchema.parse(req.body);
    push.subscribe(sub, req.headers['user-agent'] ?? null);
    return { ok: true };
  });

  fastify.post('/api/push/unsubscribe', async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2048) }).parse(req.body);
    push.unsubscribe(endpoint);
    return { ok: true };
  });

  fastify.post('/api/push/test', async () => {
    const delivered = await push.notify('test', {
      title: 'Keep An Eye',
      body: 'Les notifications fonctionnent.',
      url: '/',
      tag: 'kae-test',
    });
    return { delivered };
  });

  // Unknown API routes: JSON 404 (before the SPA fallback).
  fastify.all('/api/*', async (_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Route inconnue.' }));

  // ---------------- Static web app ----------------

  if (existsSync(config.webDist)) {
    await fastify.register(fastifyStatic, {
      root: config.webDist,
      index: false,
      wildcard: false,
      setHeaders(res, filePath) {
        const base = path.basename(filePath);
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else if (base === 'sw.js' || base.endsWith('.html') || base.endsWith('.webmanifest')) res.header('Cache-Control', 'no-cache');
      },
    });
    fastify.get('/*', async (req, reply) => {
      const p = req.url.split('?')[0]!;
      if (p.startsWith('/ws/')) return reply.code(404).send();
      // Real files are served by @fastify/static (wildcard: false registers one route per file).
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  // ---------------- WebSockets ----------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const terminalSockets = new Set<WebSocket>();
  function closeTerminals() {
    for (const ws of terminalSockets) ws.close(4401, 'logout-all');
  }

  function reject(socket: Duplex, status: number, text: string) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  fastify.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!isOriginAllowed(req.headers.origin, config.allowedOrigins)) return reject(socket, 403, 'Forbidden');
      const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE];
      if (!sessions.validate(token)) return reject(socket, 401, 'Unauthorized');

      if (url.pathname === '/ws/live') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          watchSession(ws, token!);
          hub.add(ws);
        });
        return;
      }
      const m = /^\/ws\/term\/([^/]+)$/.exec(url.pathname);
      if (m) {
        let name: string;
        try {
          name = decodeURIComponent(m[1]!);
        } catch {
          return reject(socket, 400, 'Bad Request');
        }
        if (!(await sessionService.exists(name))) return reject(socket, 404, 'Not Found');
        const cols = clampInt(url.searchParams.get('cols'), 2, 1000, 80);
        const rows = clampInt(url.searchParams.get('rows'), 2, 500, 24);
        wss.handleUpgrade(req, socket, head, (ws) => {
          terminalSockets.add(ws);
          ws.on('close', () => terminalSockets.delete(ws));
          watchSession(ws, token!);
          audit.record('terminal.opened', { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null }, { name });
          bridgeTerminal(ws, tmux, name, cols, rows);
        });
        return;
      }
      reject(socket, 404, 'Not Found');
    })().catch(() => reject(socket, 500, 'Internal Server Error'));
  });

  /** Re-checks the session every minute: an expired or revoked session closes its sockets. */
  const watched = new Map<WebSocket, string>();
  function watchSession(ws: WebSocket, token: string) {
    watched.set(ws, token);
    ws.on('close', () => watched.delete(ws));
  }
  const revalidateTimer = setInterval(() => {
    for (const [ws, token] of watched) {
      if (!sessions.validate(token)) ws.close(4401, 'session-expired');
    }
  }, 60_000);
  revalidateTimer.unref();

  // ---------------- Background ----------------

  let maintenance: NodeJS.Timeout | null = null;
  if (deps.background !== false) {
    watcher.start();
    maintenance = setInterval(() => {
      sessions.purgeExpired();
      audit.prune();
      tracker.prune();
    }, 10 * 60_000);
    maintenance.unref();
  }

  return {
    fastify,
    hub,
    tracker,
    watcher,
    sessions,
    push,
    audit,
    async close() {
      watcher.stop();
      if (maintenance) clearInterval(maintenance);
      clearInterval(revalidateTimer);
      hub.stop();
      for (const ws of terminalSockets) ws.terminate();
      wss.close();
      await fastify.close();
    },
  };
}

function clampInt(v: string | null, min: number, max: number, def: number): number {
  const n = Number(v);
  if (!Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}
