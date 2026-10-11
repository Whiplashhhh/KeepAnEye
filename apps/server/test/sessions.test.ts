import { describe, expect, it } from 'vitest';
import { hashToken, PREAUTH_MS, SESSION_IDLE_MS, SESSION_MAX_MS, SessionStore } from '../src/auth/sessions.js';
import { memDb } from './helpers.js';

function store() {
  let now = 1_000_000;
  const db = memDb();
  const s = new SessionStore(db, () => now);
  return { s, db, advance: (ms: number) => (now += ms) };
}

describe('SessionStore', () => {
  it('creates 256-bit random tokens and stores only their hash', () => {
    const { s, db } = store();
    const token = s.create({ ip: '1.2.3.4', userAgent: 'ua' });
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(s.create({ ip: null, userAgent: null })).not.toBe(token);
    const rows = db.prepare('SELECT id_hash FROM sessions').all() as { id_hash: string }[];
    expect(rows.map((r) => r.id_hash)).toContain(hashToken(token));
    for (const r of rows) expect(r.id_hash).not.toContain(token);
  });

  it('validates good tokens and rejects junk', () => {
    const { s } = store();
    const token = s.create({ ip: null, userAgent: null });
    expect(s.validate(token)).toBe(true);
    expect(s.validate(undefined)).toBe(false);
    expect(s.validate('')).toBe(false);
    expect(s.validate('x'.repeat(43))).toBe(false);
    expect(s.validate(`${token}x`)).toBe(false);
  });

  it('expires after 12 h of inactivity', () => {
    const { s, advance } = store();
    const token = s.create({ ip: null, userAgent: null });
    advance(SESSION_IDLE_MS - 1000);
    expect(s.validate(token)).toBe(true); // refreshes the idle timer
    advance(SESSION_IDLE_MS - 1000);
    expect(s.validate(token)).toBe(true);
    advance(SESSION_IDLE_MS + 1);
    expect(s.validate(token)).toBe(false);
    // Deleted, not just refused.
    expect(s.count()).toBe(0);
  });

  it('expires after 7 days even if active', () => {
    const { s, advance } = store();
    const token = s.create({ ip: null, userAgent: null });
    for (let elapsed = 0; elapsed < SESSION_MAX_MS - 3600_000; elapsed += 3600_000) {
      advance(3600_000);
      expect(s.validate(token)).toBe(true);
    }
    advance(3600_000 + 1);
    expect(s.validate(token)).toBe(false);
  });

  it('logout and logout-all', () => {
    const { s } = store();
    const a = s.create({ ip: null, userAgent: null });
    const b = s.create({ ip: null, userAgent: null });
    s.destroy(a);
    expect(s.validate(a)).toBe(false);
    expect(s.validate(b)).toBe(true);
    s.create({ ip: null, userAgent: null });
    expect(s.destroyAll()).toBe(2);
    expect(s.validate(b)).toBe(false);
  });

  it('pre-auth tokens expire after 5 minutes', () => {
    const { s, advance } = store();
    const pre = s.createPreauth('1.1.1.1');
    expect(s.validatePreauth(pre)).toBe(true);
    advance(PREAUTH_MS + 1);
    expect(s.validatePreauth(pre)).toBe(false);
  });

  it('purges expired rows', () => {
    const { s, advance } = store();
    s.create({ ip: null, userAgent: null });
    advance(SESSION_IDLE_MS + 1);
    s.purgeExpired();
    expect(s.count()).toBe(0);
  });
});
