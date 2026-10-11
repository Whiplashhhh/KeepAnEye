import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT, LoginRateLimiter } from '../src/auth/rateLimit.js';

describe('LoginRateLimiter', () => {
  it('allows up to the threshold, then locks the IP', () => {
    const l = new LoginRateLimiter();
    for (let i = 0; i < 4; i++) {
      l.recordFailure('1.1.1.1', 0);
      expect(l.check('1.1.1.1', 0).allowed).toBe(true);
    }
    l.recordFailure('1.1.1.1', 0);
    const d = l.check('1.1.1.1', 1000);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.scope).toBe('ip');
      expect(d.retryAfterMs).toBe(59_000);
    }
    // Other IPs are unaffected.
    expect(l.check('2.2.2.2', 1000).allowed).toBe(true);
    // Lock expires.
    expect(l.check('1.1.1.1', 60_001).allowed).toBe(true);
  });

  it('doubles the lock at each further failure, capped', () => {
    const l = new LoginRateLimiter();
    let t = 0;
    const lockAfterFailure = () => {
      l.recordFailure('ip', t);
      const d = l.check('ip', t);
      return d.allowed ? 0 : d.retryAfterMs;
    };
    for (let i = 0; i < 4; i++) lockAfterFailure();
    expect(lockAfterFailure()).toBe(60_000);
    t += 60_001;
    expect(lockAfterFailure()).toBe(120_000);
    t += 120_001;
    expect(lockAfterFailure()).toBe(240_000);
    for (let i = 0; i < 10; i++) {
      t += DEFAULT_RATE_LIMIT.maxLockMs + 1;
      lockAfterFailure();
    }
    t += DEFAULT_RATE_LIMIT.maxLockMs + 1;
    expect(lockAfterFailure()).toBe(DEFAULT_RATE_LIMIT.maxLockMs);
  });

  it('success resets the IP counter', () => {
    const l = new LoginRateLimiter();
    for (let i = 0; i < 4; i++) l.recordFailure('ip', 0);
    l.recordSuccess('ip');
    l.recordFailure('ip', 0);
    expect(l.check('ip', 0).allowed).toBe(true);
  });

  it('locks everyone after too many failures overall (distributed attack)', () => {
    const l = new LoginRateLimiter({ ...DEFAULT_RATE_LIMIT, globalThreshold: 10 });
    for (let i = 0; i < 10; i++) l.recordFailure(`10.0.0.${i}`, i * 1000);
    const d = l.check('192.168.1.1', 10_000);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.scope).toBe('global');
    expect(l.check('192.168.1.1', 10_000 + DEFAULT_RATE_LIMIT.globalLockMs).allowed).toBe(true);
  });

  it('global window slides: old failures are forgotten', () => {
    const l = new LoginRateLimiter({ ...DEFAULT_RATE_LIMIT, globalThreshold: 10 });
    for (let i = 0; i < 9; i++) l.recordFailure(`10.0.0.${i}`, 0);
    l.recordFailure('10.0.1.1', DEFAULT_RATE_LIMIT.globalWindowMs + 1);
    expect(l.check('x', DEFAULT_RATE_LIMIT.globalWindowMs + 2).allowed).toBe(true);
  });
});
