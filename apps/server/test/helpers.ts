import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db.js';

export function tempDir(prefix = 'kae-test-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function memDb() {
  return openDb(':memory:');
}

export const ORIGIN = 'https://box.tail1234.ts.net';

export function testConfig(overrides: Partial<Config> = {}): Config {
  const root = tempDir();
  const claudeBoxDir = path.join(root, 'claude-box');
  mkdirSync(path.join(claudeBoxDir, 'workspace', 'webapp'), { recursive: true });
  mkdirSync(path.join(claudeBoxDir, 'workspace', 'api'), { recursive: true });
  mkdirSync(path.join(claudeBoxDir, 'events'), { recursive: true });
  return {
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: [ORIGIN],
    dataDir: path.join(root, 'data'),
    dbFile: ':memory:',
    claudeBoxDir,
    workspaceDir: path.join(claudeBoxDir, 'workspace'),
    eventsFile: path.join(claudeBoxDir, 'events', 'claude.jsonl'),
    claudeHomeDir: path.join(claudeBoxDir, 'claude-home'),
    templatesFile: path.resolve(import.meta.dirname, '../../../config/templates.json'),
    tmuxBin: 'tmux',
    tmuxRequireServer: false,
    tmuxSocket: undefined,
    dockerBin: 'docker',
    hostLabel: 'test-host',
    shell: '/bin/bash',
    cookieSecure: true,
    vapidSubject: 'mailto:test@example.com',
    webDist: path.join(root, 'no-web-dist'),
    logLevel: 'silent',
    ...overrides,
  };
}
