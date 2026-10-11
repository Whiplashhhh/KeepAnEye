import { describe, expect, it } from 'vitest';
import {
  consumeRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  matchesRecoveryCode,
  regenerateRecoveryCodes,
  remainingRecoveryCodes,
} from '../src/auth/recovery.js';
import { memDb } from './helpers.js';

describe('recovery codes', () => {
  it('generates 10 unique well-formed codes', () => {
    const db = memDb();
    const codes = regenerateRecoveryCodes(db);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });

  it('stores only salted hashes', () => {
    const db = memDb();
    const codes = regenerateRecoveryCodes(db);
    const rows = db.prepare('SELECT code_hash FROM recovery_codes').all() as { code_hash: string }[];
    for (const r of rows) {
      for (const c of codes) expect(r.code_hash).not.toContain(c.replace('-', ''));
      expect(r.code_hash).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{64}$/);
    }
    const a = hashRecoveryCode('abcde-fghjk');
    const b = hashRecoveryCode('abcde-fghjk');
    expect(a).not.toBe(b);
    expect(matchesRecoveryCode('abcde-fghjk', a)).toBe(true);
    expect(matchesRecoveryCode('abcde-fghjm', a)).toBe(false);
  });

  it('is single use', () => {
    const db = memDb();
    const [first, second] = regenerateRecoveryCodes(db);
    expect(consumeRecoveryCode(db, first!, 1)).toBe(true);
    expect(consumeRecoveryCode(db, first!, 2)).toBe(false);
    expect(remainingRecoveryCodes(db)).toBe(9);
    // Case and separators are forgiven.
    expect(consumeRecoveryCode(db, second!.toUpperCase().replace('-', ' '), 3)).toBe(true);
  });

  it('rejects unknown or malformed codes', () => {
    const db = memDb();
    regenerateRecoveryCodes(db);
    expect(consumeRecoveryCode(db, generateRecoveryCode(), 1)).toBe(false);
    expect(consumeRecoveryCode(db, '', 1)).toBe(false);
    expect(consumeRecoveryCode(db, "' OR 1=1 --", 1)).toBe(false);
  });

  it('regenerating invalidates the old codes', () => {
    const db = memDb();
    const old = regenerateRecoveryCodes(db);
    regenerateRecoveryCodes(db);
    expect(consumeRecoveryCode(db, old[0]!, 1)).toBe(false);
  });
});
