import type { AuditEntry } from '@kae/shared';
import type { DB } from './db.js';

export type AuditEvent =
  | 'login.password_failed'
  | 'login.password_ok'
  | 'login.second_factor_failed'
  | 'login.success'
  | 'login.recovery_code_used'
  | 'login.blocked'
  | 'logout'
  | 'logout.all'
  | 'session.created'
  | 'session.closed'
  | 'session.renamed'
  | 'session.upload'
  | 'fs.mkdir'
  | 'ssh_host.created'
  | 'ssh_host.updated'
  | 'ssh_host.deleted'
  | 'terminal.opened'
  | 'admin.init'
  | 'admin.reset_2fa'
  | 'admin.reset_password';

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

const MAX_ROWS = 10_000;

export class AuditLog {
  constructor(
    private readonly db: DB,
    private readonly now: () => number = Date.now,
  ) {}

  record(event: AuditEvent, ctx: AuditContext = {}, detail?: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_log (ts, event, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?)')
      .run(this.now(), event, ctx.ip ?? null, ctx.userAgent?.slice(0, 300) ?? null, detail ? JSON.stringify(detail) : null);
  }

  list(limit = 200, before?: number): AuditEntry[] {
    const rows = (
      before
        ? this.db.prepare('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit)
        : this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit)
    ) as { id: number; ts: number; event: string; ip: string | null; user_agent: string | null; detail: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      event: r.event,
      ip: r.ip,
      userAgent: r.user_agent,
      detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null,
    }));
  }

  prune(): void {
    this.db.prepare('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - ?').run(MAX_ROWS);
  }
}
