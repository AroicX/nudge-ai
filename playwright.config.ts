import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm --filter @nudge/fixtures dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
