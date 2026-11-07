import type { DB } from '../db.js';

export interface AdminRow {
  password_hash: string;
}

export function getAdmin(db: DB): AdminRow | undefined {
  return db.prepare('SELECT password_hash FROM admin WHERE id = 1').get() as AdminRow | undefined;
}

export function isAdminReady(db: DB): boolean {
  return !!getAdmin(db);
}

export function setAdmin(db: DB, passwordHash: string, now: number): void {
  db.prepare(
    `INSERT INTO admin (id, password_hash, created_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash`,
  ).run(passwordHash, now);
}

export function setPasswordHash(db: DB, passwordHash: string): void {
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(passwordHash);
}
