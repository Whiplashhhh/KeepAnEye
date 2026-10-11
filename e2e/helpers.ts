import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';

export interface ServerState {
  origin: string;
  sessionToken: string;
  recovery: string[];
  socket: string;
}

export function serverState(mode: 'e2e' | 'demo'): ServerState {
  return JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '.e2e', mode, 'state.json'), 'utf8')) as ServerState;
}

/** Signs the browser in with the pre-made session (specs that don't test the login itself). */
export async function signIn(context: BrowserContext, mode: 'e2e' | 'demo'): Promise<void> {
  const s = serverState(mode);
  await context.addCookies([
    { name: 'kae_sid', value: s.sessionToken, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Strict' },
  ]);
}
