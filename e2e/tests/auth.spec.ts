import { expect, test } from '@playwright/test';

const PASSWORD = 'e2e-password-correct-horse';

test('login with the password alone, then logout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep An Eye' })).toBeVisible();

  // Wrong password: human error message, still on the login screen.
  await page.getByLabel('Mot de passe').fill('wrong password');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toHaveText('Identifiants incorrects.');

  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByRole('heading', { name: 'Sessions' }).or(page.getByText('Choisis une session')).or(page.getByText('Rien à surveiller')).first()).toBeVisible();
  const cookies = await page.context().cookies();
  const sid = cookies.find((c) => c.name === 'kae_sid')!;
  expect(sid).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
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
