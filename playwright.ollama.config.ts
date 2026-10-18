import { defineConfig } from '@playwright/test';

// Start the isolated live backend on port 4319 with an empty OPENAI_API_KEY and Ollama
// with qwen3.5:9b installed before running this deliberately opt-in suite.
process.env.WXT_PUBLIC_NUDGE_SERVER_URL ??= 'http://127.0.0.1:4319';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'accept-ollama-workflows.spec.ts',
  globalSetup: './tests/browser/helpers/global-setup.ts',
  timeout: 600_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { actionTimeout: 15_000 },
  projects: [{ name: 'ollama-live' }],
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/ollama-results.json' }]],
});
