import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db.js';

export const SESSION_IDLE_MS = 12 * 60 * 60_000;
export const SESSION_MAX_MS = 7 * 24 * 60 * 60_000;
export const PREAUTH_MS = 5 * 60_000;
/** last_seen_at is written at most this often to avoid a DB write per request. */
const TOUCH_INTERVAL_MS = 60_000;

export const SESSION_COOKIE = 'kae_sid';
export const PREAUTH_COOKIE = 'kae_pre';

/** 256-bit random identifier, base64url. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

export class SessionStore {
  constructor(
    private readonly db: DB,
    private readonly now: () => number = Date.now,
  ) {}

  create(meta: SessionMeta): string {
    const token = newToken();
    const t = this.now();
    this.db
      .prepare('INSERT INTO sessions (id_hash, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)')
      .run(hashToken(token), t, t, meta.ip, meta.userAgent?.slice(0, 300) ?? null);
    return token;
  }

  /** Returns true if the session is valid (and refreshes its idle timer); deletes it if expired. */
  validate(token: string | undefined): boolean {
    if (!token || !TOKEN_RE.test(token)) return false;
    const idHash = hashToken(token);
    const row = this.db.prepare('SELECT created_at, last_seen_at FROM sessions WHERE id_hash = ?').get(idHash) as
      | { created_at: number; last_seen_at: number }
      | undefined;
    if (!row) return false;
    const t = this.now();
    if (t - row.last_seen_at > SESSION_IDLE_MS || t - row.created_at > SESSION_MAX_MS) {
      this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
      return false;
    }
    if (t - row.last_seen_at > TOUCH_INTERVAL_MS) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(t, idHash);
    }
    return true;
  }

  destroy(token: string | undefined): void {
    if (!token) return;
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashToken(token));
  }

  destroyAll(): number {
    return this.db.prepare('DELETE FROM sessions').run().changes;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  }

  purgeExpired(): void {
    const t = this.now();
    this.db
      .prepare('DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?')
      .run(t - SESSION_IDLE_MS, t - SESSION_MAX_MS);
    this.db.prepare('DELETE FROM preauth WHERE created_at < ?').run(t - PREAUTH_MS);
  }

  // --- pre-auth (password OK, second factor pending) ---

  createPreauth(ip: string | null): string {
    const token = newToken();
    this.db.prepare('INSERT INTO preauth (id_hash, created_at, ip) VALUES (?, ?, ?)').run(hashToken(token), this.now(), ip);
    return token;
  }

  validatePreauth(token: string | undefined): boolean {
    if (!token || !TOKEN_RE.test(token)) return false;
    const row = this.db.prepare('SELECT created_at FROM preauth WHERE id_hash = ?').get(hashToken(token)) as
      | { created_at: number }
      | undefined;
    return !!row && this.now() - row.created_at <= PREAUTH_MS;
  }

  destroyPreauth(token: string | undefined): void {
    if (!token) return;
    this.db.prepare('DELETE FROM preauth WHERE id_hash = ?').run(hashToken(token));
  }
}
