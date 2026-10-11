import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAdmin } from '../src/auth/admin.js';
import { verifyPassword } from '../src/auth/password.js';
import { remainingRecoveryCodes } from '../src/auth/recovery.js';
import { totpAt } from '../src/auth/totp.js';
import { openDb } from '../src/db.js';
import { tempDir } from './helpers.js';

const CLI = path.resolve(import.meta.dirname, '../src/cli.ts');
const EOF = '\u0004';

/** Runs the admin CLI with piped answers; `answer` sees the output so far and returns the next line(s). */
function runCli(args: string[], dataDir: string, answer: (out: string) => string | null): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
      env: { ...process.env, KAE_DATA_DIR: dataDir, KAE_ENV_FILE: '/nonexistent', NO_COLOR: '1' },
    });
    let out = '';
    let sent = 0;
    const pump = () => {
      const next = answer(out);
      if (next === EOF) return void child.stdin.end();
      if (next !== null && sent < 20) {
        sent++;
        child.stdin.write(`${next}\n`);
      }
    };
    child.stdout.on('data', (d) => {
      out += d.toString();
      pump();
    });
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

describe('admin CLI', () => {
  it('init: password, QR code, first code, recovery codes', async () => {
    const dataDir = tempDir();
    const password = 'a very long passphrase';
    let step = 0;
    const res = await runCli(['init'], dataDir, (out) => {
      if (step === 0 && out.includes('Mot de passe (')) return (step++, password);
      if (step === 1 && out.includes('Confirme')) return (step++, password);
      const m = /Secret : \S*?([A-Z2-7]{32})/.exec(out);
      if (step === 2 && m && out.includes('Code à 6 chiffres')) return (step++, totpAt(m[1]!, Date.now()));
      return null;
    });
    expect(res.out).toContain('otpauth://totp/');
    expect(res.out).toContain('▄'); // QR code drawn in the terminal
    expect(res.out).toMatch(/Compte prêt/);
    const codes = res.out.match(/\b[a-z2-9]{5}-[a-z2-9]{5}\b/g) ?? [];
    expect(new Set(codes).size).toBe(10);
    expect(res.code).toBe(0);

    const db = openDb(path.join(dataDir, 'keep-an-eye.db'));
    const admin = getAdmin(db)!;
    expect(await verifyPassword(admin.password_hash, password)).toBe(true);
    expect(admin.password_hash).toMatch(/^\$argon2id\$/);
    expect(admin.totp_last_step).toBeGreaterThan(0); // the enrolment code cannot be replayed
    expect(remainingRecoveryCodes(db)).toBe(10);
    db.close();

    // A second init is refused.
    const again = await runCli(['init'], dataDir, () => null);
    expect(again.code).toBe(1);
    expect(again.out).toContain('déjà initialisé');
  }, 30_000);

  it('rejects short or mismatched passwords, and writes nothing if interrupted', async () => {
    const dataDir = tempDir();
    let step = 0;
    const res = await runCli(['init'], dataDir, (out) => {
      if (step === 0 && out.includes('Mot de passe (')) return (step++, 'short');
      if (step === 1 && out.includes('Trop court')) return (step++, 'long enough password 1');
      if (step === 2 && out.includes('Confirme')) return (step++, 'different password 22');
      if (step === 3 && out.includes('ne correspondent pas')) return (step++, EOF);
      return null;
    });
    expect(step).toBe(4);
    expect(res.code).not.toBe(0);
    expect(res.out).toContain('Saisie interrompue');
    const db = openDb(path.join(dataDir, 'keep-an-eye.db'));
    expect(getAdmin(db)).toBeUndefined();
    db.close();
  }, 30_000);
});
