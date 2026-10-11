import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { signIn } from '../helpers';

const OUT = path.join(import.meta.dirname, '..', '..', 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
} as const;
const THEMES = ['dark', 'light'] as const;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // let entrance animations finish
}

for (const [device, opts] of Object.entries(VIEWPORTS)) {
  for (const theme of THEMES) {
    test(`${device} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({ ...opts, colorScheme: theme, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
      await context.addInitScript((t) => localStorage.setItem('kae.theme', t), theme);
      const page = await context.newPage();
      const shot = async (name: string) => {
        await settle(page);
        await page.screenshot({ path: path.join(OUT, `${device}-${theme}-${name}.png`) });
      };

      // Login (password, then TOTP step).
      await page.goto('/');
      await expect(page.getByLabel('Mot de passe')).toBeVisible();
      await shot('01-login');
      await page.getByLabel('Mot de passe').fill('e2e-password-correct-horse');
      await page.getByRole('button', { name: 'Continuer' }).click();
      await expect(page.getByLabel('Chiffre 1')).toBeVisible();
      await shot('02-login-totp');

      await signIn(context, 'demo');
      await page.goto('/');
      await expect(page.getByTestId('session-api-refactor').filter({ visible: true })).toBeVisible();
      await expect(page.getByRole('meter', { name: 'CPU' }).filter({ visible: true })).toBeVisible();
      await shot('03-dashboard');

      await page.goto('/s/api-refactor');
      await expect(page.getByTestId('terminal').locator('.xterm-rows')).toContainText('Do you want to proceed', { timeout: 10_000 });
      await shot('04-terminal');

      if (device === 'mobile') await page.getByRole('button', { name: 'Voir la timeline' }).click();
      else await page.getByRole('radio', { name: 'Timeline' }).click();
      await expect(page.getByText('Fichiers modifiés')).toBeVisible();
      await shot('05-timeline');

      await page.getByRole('button', { name: 'Fermer la session' }).or(page.getByRole('button', { name: 'Fermer', exact: true })).first().click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await shot('06-close-confirm');
      await page.keyboard.press('Escape');

      await page.goto('/');
      if (device === 'mobile') await page.getByRole('button', { name: 'Nouvelle session' }).last().click();
      else await page.getByRole('button', { name: 'Nouvelle session (N)' }).click();
      await page.getByText('Claude dans claude-box').click();
      await expect(page.getByLabel(/Projet/)).toBeVisible();
      await shot('07-new-session');
      await page.keyboard.press('Escape');

      await page.goto('/activity');
      await expect(page.getByText('Nouvelle demande').first()).toBeVisible();
      await shot('08-activity');

      await page.goto('/settings');
      await expect(page.getByText('Ne pas déranger')).toBeVisible();
      await shot('09-settings');

      await page.goto('/settings/audit');
      await expect(page.getByText('Connexion réussie').first()).toBeVisible();
      await shot('10-audit');

      if (device === 'desktop') {
        await page.goto('/s/webapp');
        await page.waitForTimeout(500);
        await page.locator('body').click({ position: { x: 200, y: 20 } });
        await page.keyboard.press('Control+k');
        await expect(page.getByRole('combobox')).toBeVisible();
        await page.keyboard.type('ap');
        await shot('11-palette');
        await page.keyboard.press('Escape');
      }

      // Empty state: replace the live feed with an empty session list.
      await page.routeWebSocket(/\/ws\/live$/, (ws) => {
        ws.send(JSON.stringify({ type: 'sessions', sessions: [] }));
        ws.send(
          JSON.stringify({
            type: 'host',
            host: { hostname: 'homelab', cpu: 0.07, load: [0.3, 0.2, 0.1], memUsed: 6.1e9, memTotal: 33.4e9, diskUsed: 371e9, diskTotal: 915e9, uptime: 1, container: { state: 'running', detail: 'Up 3 days' }, updatedAt: Date.now() },
          }),
        );
      });
      await page.goto('/');
      await expect(page.getByText('Aucune session').filter({ visible: true }).first()).toBeVisible();
      await shot('12-empty');

      await context.close();
    });
  }
}
