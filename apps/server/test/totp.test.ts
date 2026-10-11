import { describe, expect, it } from 'vitest';
import { checkAndConsumeTotp, setAdmin } from '../src/auth/admin.js';
import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from '../src/auth/totp.js';
import { memDb } from './helpers.js';

// RFC 6238 test secret "12345678901234567890" (ASCII), SHA-1.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('base32 round-trips', () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 7, 99]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, i) => expect(hotp(RFC_SECRET, i)).toBe(code));
  });

  it('matches the RFC 6238 TOTP vectors (6 digits)', () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1111111109_000)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1234567890_000)).toBe('005924');
    expect(totpAt(RFC_SECRET, 2000000000_000)).toBe('279037');
  });

  it('accepts ±1 period and rejects further drift', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now, 0)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now, 0)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), now, 0)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90_000), now, 0)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 90_000), now, 0)).toBeNull();
  });

  it('rejects malformed codes', () => {
    const now = 1_700_000_000_000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', '١٢٣٤٥٦']) {
      expect(verifyTotp(RFC_SECRET, bad, now, 0)).toBeNull();
    }
  });

  it('refuses steps at or before the last used one', () => {
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    const step = verifyTotp(RFC_SECRET, code, now, 0)!;
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    // An older (still in-window) code is refused once a newer one was used.
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now, step)).toBeNull();
  });

  it('anti-replay: a code is accepted once, then refused (persisted)', () => {
    const db = memDb();
    setAdmin(db, 'hash', RFC_SECRET, 0);
    const now = Date.now();
    const code = totpAt(RFC_SECRET, now);
    expect(checkAndConsumeTotp(db, code, now)).toBe(true);
    expect(checkAndConsumeTotp(db, code, now)).toBe(false);
    expect(checkAndConsumeTotp(db, code, now + 10_000)).toBe(false);
    // The next period's code works.
    expect(checkAndConsumeTotp(db, totpAt(RFC_SECRET, now + 30_000), now + 30_000)).toBe(true);
  });

  it('builds an otpauth URI understood by authenticator apps', () => {
    const uri = otpauthUri('ABCDEF', 'server');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Keep%20An%20Eye%3Aserver\?/);
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('ABCDEF');
    expect(params.get('issuer')).toBe('Keep An Eye');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});
