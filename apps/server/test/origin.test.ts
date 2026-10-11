import { describe, expect, it } from 'vitest';
import { isOriginAllowed, requiresOriginCheck } from '../src/auth/origin.js';

const allowed = ['https://box.tail1234.ts.net'];

describe('Origin check', () => {
  it('accepts the exact configured origin', () => {
    expect(isOriginAllowed('https://box.tail1234.ts.net', allowed)).toBe(true);
    expect(isOriginAllowed('https://box.tail1234.ts.net/', allowed)).toBe(true);
  });

  it('rejects missing, null and look-alike origins', () => {
    for (const o of [
      undefined,
      '',
      'null',
      'http://box.tail1234.ts.net',
      'https://box.tail1234.ts.net.evil.com',
      'https://evil.box.tail1234.ts.net',
      'https://box.tail1234.ts.net:8443',
      'https://BOX.tail1234.ts.net.evil',
    ]) {
      expect(isOriginAllowed(o, allowed)).toBe(false);
    }
  });

  it('applies to state-changing methods only', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) expect(requiresOriginCheck(m)).toBe(true);
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(requiresOriginCheck(m)).toBe(false);
  });
});
