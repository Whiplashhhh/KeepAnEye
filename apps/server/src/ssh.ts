import type { SshHost, SshHostInput } from '@kae/shared';
import type { DB } from './db.js';
import { HttpError } from './http/errors.js';

interface Row {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string | null;
  identity_file: string | null;
  created_at: number;
}

const toHost = (r: Row): SshHost => ({
  id: r.id,
  name: r.name,
  host: r.host,
  port: r.port,
  user: r.username,
  identityFile: r.identity_file,
  createdAt: r.created_at,
});

/**
 * Arguments that make `ssh` connect to a saved machine. Values were validated when saved (host never
 * starts with "-", user and key path are checked too) and `--` ends option parsing before the host.
 * Authentication is left to ssh itself: agent, keys, or a password typed in the terminal. Nothing secret is stored.
 */
export function sshArgs(m: Pick<SshHost, 'host' | 'port' | 'user' | 'identityFile'>): string[] {
  const args: string[] = [];
  if (m.port !== 22) args.push('-p', String(m.port));
  if (m.user) args.push('-l', m.user);
  if (m.identityFile) args.push('-i', m.identityFile, '-o', 'IdentitiesOnly=yes');
  args.push('--', m.host);
  return args;
}

/** SSH machines saved in the app, to open terminals on other servers (a VPS, a Raspberry Pi…). */
export class SshHostStore {
  constructor(
    private readonly db: DB,
    private readonly now: () => number = Date.now,
  ) {}

  list(): SshHost[] {
    return (this.db.prepare('SELECT * FROM ssh_hosts ORDER BY name COLLATE NOCASE').all() as Row[]).map(toHost);
  }

  get(id: number): SshHost | null {
    const row = this.db.prepare('SELECT * FROM ssh_hosts WHERE id = ?').get(id) as Row | undefined;
    return row ? toHost(row) : null;
  }

  create(input: SshHostInput): SshHost {
    try {
      const res = this.db
        .prepare('INSERT INTO ssh_hosts (name, host, port, username, identity_file, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.name, input.host, input.port, input.user, input.identityFile, this.now());
      return this.get(Number(res.lastInsertRowid))!;
    } catch (e) {
      throw nameTaken(e, input.name);
    }
  }

  update(id: number, input: SshHostInput): SshHost {
    try {
      const res = this.db
        .prepare('UPDATE ssh_hosts SET name = ?, host = ?, port = ?, username = ?, identity_file = ? WHERE id = ?')
        .run(input.name, input.host, input.port, input.user, input.identityFile, id);
      if (res.changes === 0) throw notFound();
    } catch (e) {
      throw nameTaken(e, input.name);
    }
    return this.get(id)!;
  }

  delete(id: number): SshHost {
    const existing = this.get(id);
    if (!existing) throw notFound();
    this.db.prepare('DELETE FROM ssh_hosts WHERE id = ?').run(id);
    return existing;
  }
}

const notFound = () => new HttpError(404, 'not_found', 'Cette machine SSH n’existe plus.');

function nameTaken(e: unknown, name: string): unknown {
  if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
    return new HttpError(409, 'ssh_name_taken', `Une machine « ${name} » existe déjà.`);
  }
  return e;
}
