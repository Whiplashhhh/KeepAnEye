import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY,
    code_hash TEXT NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE TABLE preauth (
    id_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    ip TEXT
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    event TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    detail TEXT
  );
  CREATE INDEX audit_log_ts ON audit_log (ts);
  CREATE TABLE claude_state (
    session TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    claude_session_id TEXT,
    cwd TEXT,
    transcript_path TEXT,
    last_event TEXT,
    last_message TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    session TEXT NOT NULL,
    status TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX activity_ts ON activity (ts);
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE ssh_hosts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT,
    identity_file TEXT,
    created_at INTEGER NOT NULL
  );
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function kvGet<T>(db: DB, key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}
