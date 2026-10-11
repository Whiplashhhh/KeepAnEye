import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

test.beforeEach(async ({ context }) => {
  await signIn(context, 'e2e');
});

test('dashboard: empty state, host strip and live title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'État du serveur' }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'CPU' }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Aucune session').filter({ visible: true }).first()).toBeVisible();
  await expect(page).toHaveTitle('Keep An Eye');
});

test('create a terminal session, use it live, then close it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle session (N)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await expect(dialog).toBeVisible();
  await dialog.getByText('Terminal', { exact: true }).click();
  const name = dialog.getByLabel('Nom');
  await expect(name).toHaveValue(/^shell-\d+$/);
  await name.fill('e2e-shell');
  await dialog.getByRole('button', { name: 'Créer la session' }).click();

  // Lands on the live terminal.
  await expect(page).toHaveURL(/\/s\/e2e-shell$/);
  await expect(page.getByText('Session « e2e-shell » créée')).toBeVisible();
  const rows = page.getByTestId('terminal').locator('.xterm-rows');
  await expect(rows).toContainText('$', { timeout: 10_000 });
  await page.getByTestId('terminal').click();
  await page.keyboard.type('echo kae-$((6*7))');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('kae-42');

  // The card shows up in the list with a live preview.
  const card = page.getByTestId('session-e2e-shell').filter({ visible: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('kae-42', { timeout: 10_000 });

  // Name collisions are explained before submitting.
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 700, y: 10 } });
  await page.getByRole('button', { name: 'Nouvelle session (N)' }).click();
  await page.getByRole('dialog').getByLabel('Nom').fill('e2e-shell');
  await expect(page.getByText('Ce nom est déjà pris.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer la session' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Close with confirmation.
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('e2e-shell');
  await confirm.getByRole('button', { name: 'Fermer e2e-shell' }).click();
  await expect(page.getByText('Session « e2e-shell » fermée')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('session-e2e-shell')).toHaveCount(0);
});

test('a terminal survives closing the tab (detach, not kill)', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle session (N)' }).click();
  await page.getByRole('dialog').getByLabel('Nom').fill('e2e-persist');
  await page.getByRole('dialog').getByRole('button', { name: 'Créer la session' }).click();
  await expect(page.getByTestId('terminal').locator('.xterm-rows')).toContainText('$', { timeout: 10_000 });
  await page.getByTestId('terminal').click();
  await page.keyboard.type('export KAE_MARK=still-here');
  await page.keyboard.press('Enter');
  await page.close();

  const again = await context.newPage();
  await again.goto('/s/e2e-persist');
  await expect(again.getByTestId('terminal').locator('.xterm-rows')).toContainText('$', { timeout: 10_000 });
  await again.getByTestId('terminal').click();
  await again.keyboard.type('echo $KAE_MARK');
  await again.keyboard.press('Enter');
  await expect(again.getByTestId('terminal').locator('.xterm-rows')).toContainText('still-here');

  const res = await again.request.delete('/api/sessions/e2e-persist', { headers: { origin: new URL(again.url()).origin } });
  expect(res.ok()).toBe(true);
});

test('command palette opens sessions and actions', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox');
  await expect(box).toBeVisible();
  await box.fill('activ');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole('heading', { name: 'Activité' })).toBeVisible();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Raccourcis clavier' })).toBeVisible();
});

test('paste: Ctrl+V pastes text, a pasted image is uploaded and its path typed', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle session (N)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await dialog.getByText('Terminal', { exact: true }).click();
  await dialog.getByLabel('Nom').fill('e2e-paste');
  await dialog.getByRole('button', { name: 'Créer la session' }).click();
  const rows = page.getByTestId('terminal').locator('.xterm-rows');
  await expect(rows).toContainText('$', { timeout: 10_000 });
  await page.getByTestId('terminal').click();

  await page.evaluate(() => navigator.clipboard.writeText('echo pasted-$((40+2))'));
  await page.keyboard.press('Control+V');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('pasted-42');

  // A screenshot on the clipboard: the browser's paste event carries it as a file.
  await page.evaluate(() => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([png], 'shot.png', { type: 'image/png' }));
    document.querySelector('.xterm-helper-textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(rows).toContainText('.kae-uploads/paste-', { timeout: 10_000 });
  await expect(rows).toContainText('.png');

  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Fermer e2e-paste' }).click();
  await expect(page.getByText('Session « e2e-paste » fermée')).toBeVisible();
});

test('Shift+Enter sends ESC+CR (newline in Claude Code), Enter stays a plain CR', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle session (N)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session' });
  await dialog.getByText('Terminal', { exact: true }).click();
  await dialog.getByLabel('Nom').fill('e2e-shift');
  await dialog.getByRole('button', { name: 'Créer la session' }).click();
  const rows = page.getByTestId('terminal').locator('.xterm-rows');
  await expect(rows).toContainText('$', { timeout: 10_000 });
  await page.getByTestId('terminal').click();

  // Raw mode, then show the bytes received as hex.
  await page.keyboard.type("stty raw -echo; od -An -tx1 -N3; stty sane");
  await page.keyboard.press('Enter');
  await expect(rows).toContainText(':od', { timeout: 10_000 }); // od is running, the tty is raw
  await page.waitForTimeout(300);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('1b 0d 0d', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Fermer e2e-shift' }).click();
  await expect(page.getByText('Session « e2e-shift » fermée')).toBeVisible();
});
