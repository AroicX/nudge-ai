import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'accept-direct-navigation.spec.ts',
  globalSetup: './tests/browser/helpers/global-setup.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
});
