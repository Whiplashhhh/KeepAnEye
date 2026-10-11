import { hostname } from 'node:os';
import { createInterface } from 'node:readline';
import QRCode from 'qrcode';
import { AuditLog } from './audit.js';
import { getAdmin, setAdmin, setPasswordHash, setTotpSecret } from './auth/admin.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './auth/password.js';
import { regenerateRecoveryCodes } from './auth/recovery.js';
import { SessionStore } from './auth/sessions.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './auth/totp.js';
import { loadConfig } from './config.js';
import type { DB } from './db.js';
import { openDb } from './db.js';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

/** Line reader that works both interactively and with piped input (one answer per line). */
class Prompt {
  private readonly lines: string[] = [];
  private readonly waiters: ((l: string | null) => void)[] = [];
  private closed = false;
  private readonly rl;
  private muted = false;

  constructor() {
    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    // Hide what is typed for secrets.
    const rlAny = this.rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    const orig = rlAny._writeToOutput.bind(this.rl);
    rlAny._writeToOutput = (s: string) => {
      if (!this.muted || s.includes('\n') || s.includes('\r')) orig(s);
      else if (s.length > 0) orig('•'.repeat(s.length));
    };
    this.rl.on('line', (l) => {
      const w = this.waiters.shift();
      if (w) w(l);
      else this.lines.push(l);
    });
    this.rl.on('close', () => {
      this.closed = true;
      for (const w of this.waiters.splice(0)) w(null);
    });
  }

  async ask(question: string, secret = false): Promise<string> {
    process.stdout.write(question);
    this.muted = secret && !!process.stdin.isTTY;
    const line = this.lines.shift() ?? (this.closed ? null : await new Promise<string | null>((r) => this.waiters.push(r)));
    this.muted = false;
    if (!process.stdin.isTTY) process.stdout.write('\n');
    if (line === null) throw new Error('Saisie interrompue.');
    return line;
  }

  close(): void {
    this.rl.close();
  }
}

async function askNewPassword(p: Prompt): Promise<string> {
  for (;;) {
    const pw = await p.ask(`Mot de passe (${MIN_PASSWORD_LENGTH} caractères minimum) : `, true);
    if (pw.length < MIN_PASSWORD_LENGTH) {
      console.log(amber(`  Trop court : au moins ${MIN_PASSWORD_LENGTH} caractères.`));
      continue;
    }
    const again = await p.ask('Confirme le mot de passe : ', true);
    if (pw !== again) {
      console.log(amber('  Les deux saisies ne correspondent pas, recommence.'));
      continue;
    }
    return pw;
  }
}

/** Shows the QR code, asks for a first code and returns the secret and the step used (anti-replay). */
async function enrollTotp(p: Prompt): Promise<{ secret: string; step: number }> {
  const secret = generateTotpSecret();
  const uri = otpauthUri(secret, hostname());
  console.log(`\n${bold('Double authentification')}`);
  console.log('Scanne ce QR code avec ton application (Google Authenticator, Aegis, 2FAS…) :\n');
  console.log(await QRCode.toString(uri, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }));
  console.log(dim('Ou saisis cette URI / ce secret à la main :'));
  console.log(`  ${uri}`);
  console.log(`  Secret : ${bold(secret)}\n`);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const code = (await p.ask('Code à 6 chiffres affiché par l’application : ')).replace(/\s/g, '');
    const step = verifyTotp(secret, code, Date.now(), 0);
    if (step !== null) return { secret, step };
    console.log(amber('  Code incorrect. Vérifie que l’heure du téléphone et du serveur sont justes.'));
  }
  throw new Error('Trop de codes incorrects, abandon. Relance la commande.');
}

function printRecoveryCodes(codes: string[]): void {
  console.log(`\n${bold('Codes de secours')} ${dim('(usage unique, à garder hors ligne — ils ne seront plus affichés)')}`);
  for (let i = 0; i < codes.length; i += 2) console.log(`  ${codes[i]}    ${codes[i + 1] ?? ''}`);
  console.log('');
}

async function init(db: DB, p: Prompt, force: boolean): Promise<void> {
  if (getAdmin(db) && !force) {
    console.log(amber('Le compte est déjà initialisé.'));
    console.log('Utilise « npm run admin:reset-password » ou « npm run admin:reset-2fa ».');
    process.exitCode = 1;
    return;
  }
  console.log(bold('Keep An Eye — initialisation du compte'));
  console.log(dim('Créé par Willem Vanbaelinghem\n'));
  const password = await askNewPassword(p);
  const hash = await hashPassword(password);
  const { secret, step } = await enrollTotp(p);
  db.transaction(() => {
    setAdmin(db, hash, secret, Date.now());
    db.prepare('UPDATE admin SET totp_last_step = ? WHERE id = 1').run(step);
  })();
  new SessionStore(db).destroyAll();
  printRecoveryCodes(regenerateRecoveryCodes(db));
  new AuditLog(db).record('admin.init', { ip: 'cli' });
  console.log(green('✓ Compte prêt. Tu peux te connecter depuis le navigateur.'));
}

async function reset2fa(db: DB, p: Prompt): Promise<void> {
  if (!getAdmin(db)) throw new Error('Aucun compte : lance d’abord « npm run admin:init ».');
  console.log(bold('Keep An Eye — réinitialisation de la double authentification'));
  const { secret, step } = await enrollTotp(p);
  db.transaction(() => {
    setTotpSecret(db, secret);
    db.prepare('UPDATE admin SET totp_last_step = ? WHERE id = 1').run(step);
  })();
  const closed = new SessionStore(db).destroyAll();
  printRecoveryCodes(regenerateRecoveryCodes(db));
  new AuditLog(db).record('admin.reset_2fa', { ip: 'cli' }, { sessionsClosed: closed });
  console.log(green(`✓ Nouveau secret enregistré. ${closed} session(s) fermée(s).`));
}

async function resetPassword(db: DB, p: Prompt): Promise<void> {
  if (!getAdmin(db)) throw new Error('Aucun compte : lance d’abord « npm run admin:init ».');
  console.log(bold('Keep An Eye — nouveau mot de passe\n'));
  const password = await askNewPassword(p);
  setPasswordHash(db, await hashPassword(password));
  const closed = new SessionStore(db).destroyAll();
  new AuditLog(db).record('admin.reset_password', { ip: 'cli' }, { sessionsClosed: closed });
  console.log(green(`✓ Mot de passe changé. ${closed} session(s) fermée(s).`));
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const config = loadConfig();
  const db = openDb(config.dbFile);
  const p = new Prompt();
  try {
    switch (cmd) {
      case 'init':
        await init(db, p, rest.includes('--force'));
        break;
      case 'reset-2fa':
        await reset2fa(db, p);
        break;
      case 'reset-password':
        await resetPassword(db, p);
        break;
      default:
        console.log('Usage : cli.js <init [--force] | reset-2fa | reset-password>');
        process.exitCode = 2;
    }
  } catch (e) {
    console.error(amber((e as Error).message));
    process.exitCode = 1;
  } finally {
    p.close();
    db.close();
  }
}

void main();
