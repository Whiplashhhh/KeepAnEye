import type { AuditLog } from '../audit.js';
import type { DB } from '../db.js';
import { getAdmin } from './admin.js';
import { getDummyHash, verifyPassword } from './password.js';
import type { LoginRateLimiter } from './rateLimit.js';
import type { SessionStore } from './sessions.js';

export interface LoginContext {
  ip: string;
  userAgent: string | null;
}

export type LoginResult = { ok: true; token: string } | { ok: false; reason: 'invalid' | 'blocked'; retryAfterMs?: number };

export class AuthService {
  constructor(
    private readonly db: DB,
    private readonly sessions: SessionStore,
    private readonly limiter: LoginRateLimiter,
    private readonly audit: AuditLog,
    private readonly now: () => number = Date.now,
  ) {}

  /** Password login. On success returns the session token. */
  async password(password: string, ctx: LoginContext): Promise<LoginResult> {
    const decision = this.limiter.check(ctx.ip, this.now());
    if (!decision.allowed) {
      this.audit.record('login.blocked', ctx, { scope: decision.scope });
      return { ok: false, reason: 'blocked', retryAfterMs: decision.retryAfterMs };
    }
    const admin = getAdmin(this.db);
    // Always run argon2 so timing does not reveal whether an admin exists.
    const ok = await verifyPassword(admin?.password_hash ?? (await getDummyHash()), password);
    if (!ok || !admin) {
      this.limiter.recordFailure(ctx.ip, this.now());
      this.audit.record('login.password_failed', ctx);
      return { ok: false, reason: 'invalid' };
    }
    this.limiter.recordSuccess(ctx.ip);
    const token = this.sessions.create({ ip: ctx.ip, userAgent: ctx.userAgent });
    this.audit.record('login.success', ctx, { method: 'password' });
    return { ok: true, token };
  }
}
