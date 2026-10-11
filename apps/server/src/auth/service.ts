import type { AuditLog } from '../audit.js';
import type { DB } from '../db.js';
import { checkAndConsumeTotp, getAdmin } from './admin.js';
import { getDummyHash, verifyPassword } from './password.js';
import type { LoginRateLimiter } from './rateLimit.js';
import { consumeRecoveryCode, remainingRecoveryCodes } from './recovery.js';
import type { SessionStore } from './sessions.js';

export interface LoginContext {
  ip: string;
  userAgent: string | null;
}

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid' | 'blocked' | 'expired'; retryAfterMs?: number };

export class AuthService {
  constructor(
    private readonly db: DB,
    private readonly sessions: SessionStore,
    private readonly limiter: LoginRateLimiter,
    private readonly audit: AuditLog,
    private readonly now: () => number = Date.now,
  ) {}

  /** Step 1: password. On success returns a short-lived pre-auth token. */
  async password(password: string, ctx: LoginContext): Promise<LoginResult> {
    const decision = this.limiter.check(ctx.ip, this.now());
    if (!decision.allowed) {
      this.audit.record('login.blocked', ctx, { step: 'password', scope: decision.scope });
      return { ok: false, reason: 'blocked', retryAfterMs: decision.retryAfterMs };
    }
    const admin = getAdmin(this.db);
    // Always run argon2 so timing does not reveal whether an admin exists.
    const ok = await verifyPassword(admin?.password_hash ?? (await getDummyHash()), password);
    if (!ok || !admin?.totp_secret) {
      this.limiter.recordFailure(ctx.ip, this.now());
      this.audit.record('login.password_failed', ctx);
      return { ok: false, reason: 'invalid' };
    }
    this.audit.record('login.password_ok', ctx);
    return { ok: true, token: this.sessions.createPreauth(ctx.ip) };
  }

  /** Step 2: TOTP code or recovery code. On success returns the session token. */
  secondFactor(preauthToken: string | undefined, code: string, ctx: LoginContext): LoginResult {
    const decision = this.limiter.check(ctx.ip, this.now());
    if (!decision.allowed) {
      this.audit.record('login.blocked', ctx, { step: 'second_factor', scope: decision.scope });
      return { ok: false, reason: 'blocked', retryAfterMs: decision.retryAfterMs };
    }
    if (!this.sessions.validatePreauth(preauthToken)) {
      return { ok: false, reason: 'expired' };
    }
    let method: 'totp' | 'recovery' | null = null;
    if (/^\d{6}$/.test(code)) {
      if (checkAndConsumeTotp(this.db, code, this.now())) method = 'totp';
    } else if (consumeRecoveryCode(this.db, code, this.now())) {
      method = 'recovery';
    }
    if (!method) {
      this.limiter.recordFailure(ctx.ip, this.now());
      this.audit.record('login.second_factor_failed', ctx);
      return { ok: false, reason: 'invalid' };
    }
    this.sessions.destroyPreauth(preauthToken);
    this.limiter.recordSuccess(ctx.ip);
    if (method === 'recovery') {
      this.audit.record('login.recovery_code_used', ctx, { remaining: remainingRecoveryCodes(this.db) });
    }
    const token = this.sessions.create({ ip: ctx.ip, userAgent: ctx.userAgent });
    this.audit.record('login.success', ctx, { method });
    return { ok: true, token };
  }
}
