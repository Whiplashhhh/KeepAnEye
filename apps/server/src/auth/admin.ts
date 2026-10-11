import type { DB } from '../db.js';
import { verifyTotp } from './totp.js';

export interface AdminRow {
  password_hash: string;
  totp_secret: string | null;
  totp_last_step: number;
}

export function getAdmin(db: DB): AdminRow | undefined {
  return db.prepare('SELECT password_hash, totp_secret, totp_last_step FROM admin WHERE id = 1').get() as
    | AdminRow
    | undefined;
}

export function isAdminReady(db: DB): boolean {
  const a = getAdmin(db);
  return !!a && !!a.totp_secret;
}

export function setAdmin(db: DB, passwordHash: string, totpSecret: string, now: number): void {
  db.prepare(
    `INSERT INTO admin (id, password_hash, totp_secret, totp_last_step, created_at) VALUES (1, ?, ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, totp_secret = excluded.totp_secret, totp_last_step = 0`,
  ).run(passwordHash, totpSecret, now);
}

export function setPasswordHash(db: DB, passwordHash: string): void {
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(passwordHash);
}

export function setTotpSecret(db: DB, secret: string): void {
  db.prepare('UPDATE admin SET totp_secret = ?, totp_last_step = 0 WHERE id = 1').run(secret);
}

/**
 * Verifies a TOTP code and records its time step so it cannot be used again.
 * The conditional UPDATE makes acceptance atomic even with concurrent requests.
 */
export function checkAndConsumeTotp(db: DB, code: string, now: number): boolean {
  const admin = getAdmin(db);
  if (!admin?.totp_secret) return false;
  const step = verifyTotp(admin.totp_secret, code, now, admin.totp_last_step);
  if (step === null) return false;
  const res = db.prepare('UPDATE admin SET totp_last_step = ? WHERE id = 1 AND totp_last_step < ?').run(step, step);
  return res.changes === 1;
}
