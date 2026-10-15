import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testIgnore: ['**/accept-*.spec.ts', '**/fixtures-smoke.spec.ts'],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...(process.env.NUDGE_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.NUDGE_CHROMIUM_PATH } }
      : { channel: 'chrome' }),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @nudge/fixtures dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
