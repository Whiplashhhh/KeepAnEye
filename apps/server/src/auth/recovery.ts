import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)
export const RECOVERY_CODE_COUNT = 10;

/** Format: xxxxx-xxxxx (10 chars, ~49 bits of entropy each). */
export function generateRecoveryCode(): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

function hashCode(code: string, salt: string): string {
  return createHash('sha256').update(salt).update(normalizeRecoveryCode(code)).digest('hex');
}

/** Stored as `salt$sha256(salt+code)`; codes are high-entropy random values so a fast hash is fine. */
export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}$${hashCode(code, salt)}`;
}

export function matchesRecoveryCode(code: string, stored: string): boolean {
  const [salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(hashCode(code, salt), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Replaces every recovery code and returns the new plaintext codes (shown once). */
export function regenerateRecoveryCodes(db: DB): string[] {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const insert = db.prepare('INSERT INTO recovery_codes (code_hash) VALUES (?)');
  db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes').run();
    for (const c of codes) insert.run(hashRecoveryCode(c));
  })();
  return codes;
}

/** Consumes a recovery code if valid and unused. Single use, enforced atomically. */
export function consumeRecoveryCode(db: DB, code: string, now: number): boolean {
  if (!/^[a-z0-9]{10}$/.test(normalizeRecoveryCode(code))) return false;
  const rows = db.prepare('SELECT id, code_hash FROM recovery_codes WHERE used_at IS NULL').all() as {
    id: number;
    code_hash: string;
  }[];
  let hit: number | null = null;
  for (const row of rows) if (matchesRecoveryCode(code, row.code_hash) && hit === null) hit = row.id;
  if (hit === null) return false;
  const res = db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now, hit);
  return res.changes === 1;
}

export function remainingRecoveryCodes(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE used_at IS NULL').get() as { n: number }).n;
}
