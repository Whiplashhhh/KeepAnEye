/**
 * Progressive lockout for login attempts, per IP and global.
 * - per IP: after `ipThreshold` failures, locked for `baseLockMs`, doubling at each further failure up to `maxLockMs`;
 * - global: more than `globalThreshold` failures within `globalWindowMs` locks every login for `globalLockMs`.
 * In memory on purpose: a restart is a manual action on the server, which is fine.
 */
export interface RateLimitOptions {
  ipThreshold: number;
  baseLockMs: number;
  maxLockMs: number;
  ipForgetMs: number;
  globalThreshold: number;
  globalWindowMs: number;
  globalLockMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  ipThreshold: 5,
  baseLockMs: 60_000,
  maxLockMs: 60 * 60_000,
  ipForgetMs: 24 * 60 * 60_000,
  globalThreshold: 30,
  globalWindowMs: 15 * 60_000,
  globalLockMs: 15 * 60_000,
};

interface IpState {
  failures: number;
  lockedUntil: number;
  lastFailure: number;
}

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterMs: number; scope: 'ip' | 'global' };

export class LoginRateLimiter {
  private readonly ips = new Map<string, IpState>();
  private globalFailures: number[] = [];
  private globalLockedUntil = 0;

  constructor(private readonly opts: RateLimitOptions = DEFAULT_RATE_LIMIT) {}

  check(ip: string, now: number): LimitDecision {
    if (this.globalLockedUntil > now) return { allowed: false, retryAfterMs: this.globalLockedUntil - now, scope: 'global' };
    const s = this.ips.get(ip);
    if (s && s.lockedUntil > now) return { allowed: false, retryAfterMs: s.lockedUntil - now, scope: 'ip' };
    return { allowed: true };
  }

  recordFailure(ip: string, now: number): void {
    this.prune(now);
    const s = this.ips.get(ip) ?? { failures: 0, lockedUntil: 0, lastFailure: 0 };
    s.failures += 1;
    s.lastFailure = now;
    if (s.failures >= this.opts.ipThreshold) {
      const exp = s.failures - this.opts.ipThreshold;
      s.lockedUntil = now + Math.min(this.opts.baseLockMs * 2 ** exp, this.opts.maxLockMs);
    }
    this.ips.set(ip, s);

    this.globalFailures.push(now);
    this.globalFailures = this.globalFailures.filter((t) => now - t < this.opts.globalWindowMs);
    if (this.globalFailures.length >= this.opts.globalThreshold) {
      this.globalLockedUntil = now + this.opts.globalLockMs;
      this.globalFailures = [];
    }
  }

  recordSuccess(ip: string): void {
    this.ips.delete(ip);
  }

  private prune(now: number): void {
    for (const [ip, s] of this.ips) {
      if (now - s.lastFailure > this.opts.ipForgetMs && s.lockedUntil < now) this.ips.delete(ip);
    }
  }
}
