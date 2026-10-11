import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { timeStep, totpAt } from '../../apps/server/src/auth/totp';

const PASSWORD = 'e2e-password-correct-horse';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const STEP_FILE = path.join(import.meta.dirname, '..', '..', '.e2e', 'e2e', 'last-step');

/** A TOTP code never used before (the server refuses replays): waits for the next period if needed. */
async function freshCode(): Promise<string> {
  const last = existsSync(STEP_FILE) ? Number(readFileSync(STEP_FILE, 'utf8')) : 0;
  while (timeStep(Date.now()) <= last) await new Promise((r) => setTimeout(r, 500));
  writeFileSync(STEP_FILE, String(timeStep(Date.now())));
  return totpAt(SECRET, Date.now());
}

test('full login with password and TOTP, then logout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep An Eye' })).toBeVisible();

  // Wrong password: human error message, still on the password step.
  await page.getByLabel('Mot de passe').fill('wrong password');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('alert')).toHaveText('Identifiants incorrects.');

  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuer' }).click();
  const first = page.getByLabel('Chiffre 1');
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute('inputmode', 'numeric');
  await expect(first).toHaveAttribute('autocomplete', 'one-time-code');

  // A wrong code is refused and the boxes are cleared.
  await first.focus();
  await page.keyboard.type('000000');
  await expect(page.getByRole('alert')).toHaveText('Identifiants incorrects.');

  // Pasting the code fills every box and submits automatically.
  const code = await freshCode();
  await first.focus();
  await page.evaluate((c) => {
    const dt = new DataTransfer();
    dt.setData('text', c);
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, code);

  await expect(page.getByRole('heading', { name: 'Sessions' }).or(page.getByText('Choisis une session')).or(page.getByText('Rien à surveiller')).first()).toBeVisible();
  const cookies = await page.context().cookies();
  const sid = cookies.find((c) => c.name === 'kae_sid')!;
  expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });

  // The second factor cannot be replayed (anti-replay), even with the password.
  const res = await page.request.post('/api/auth/password', { data: { password: PASSWORD }, headers: { origin: new URL(page.url()).origin } });
  expect(res.ok()).toBe(true);
  const replay = await page.request.post('/api/auth/second-factor', { data: { code }, headers: { origin: new URL(page.url()).origin } });
  expect(replay.status()).toBe(401);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
});

test('recovery code works once instead of the TOTP', async ({ page }) => {
  const state = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', '.e2e', 'e2e', 'state.json'), 'utf8')) as { recovery: string[] };
  await page.goto('/');
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Utiliser un code de secours' }).click();
  await page.getByLabel('Code de secours').fill(state.recovery[0]!);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).first()).toBeAttached();
});

test('the API and WebSockets refuse anonymous and cross-origin access', async ({ page, request, baseURL }) => {
  expect((await request.get('/api/sessions')).status()).toBe(401);
  const evil = await request.post('/api/auth/password', { data: { password: 'x' }, headers: { origin: 'https://evil.example' } });
  expect(evil.status()).toBe(403);
  await page.goto('/');
  const wsResult = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(url);
        ws.onopen = () => resolve('open');
        ws.onerror = () => resolve('refused');
      }),
    `${baseURL!.replace('http', 'ws')}/ws/live`,
  );
  expect(wsResult).toBe('refused');
  const headers = (await request.get('/')).headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['referrer-policy']).toBe('no-referrer');
});
