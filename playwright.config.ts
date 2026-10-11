import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = 7791;
const DEMO_PORT = 7792;

export default defineConfig({
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
  projects: [
    {
      name: 'e2e',
      testDir: 'e2e/tests',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${E2E_PORT}` },
    },
    {
      name: 'screenshots',
      testDir: 'e2e/screenshots',
      timeout: 180_000,
      use: { baseURL: `http://localhost:${DEMO_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'npx tsx e2e/start-server.ts',
      env: { KAE_E2E_MODE: 'e2e', KAE_E2E_PORT: String(E2E_PORT) },
      url: `http://127.0.0.1:${E2E_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: 'npx tsx e2e/start-server.ts',
      env: { KAE_E2E_MODE: 'demo', KAE_E2E_PORT: String(DEMO_PORT) },
      url: `http://127.0.0.1:${DEMO_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
    },
  ],
});
