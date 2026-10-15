import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const envFile = existsSync('.env') ? '.env' : '.env.example';
const env = parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>;
export const PAIRING_SECRET = env.NUDGE_PAIRING_SECRET ?? '';

/**
 * Acceptance runs: real extension loaded in Chromium, local fixtures, and the backend
 * started with the test-only scripted planner (no OpenAI calls). Dev-only; never shipped.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['**/accept-*.spec.ts', '**/fixtures-smoke.spec.ts'],
  globalSetup: './tests/browser/helpers/global-setup.ts',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @nudge/fixtures dev',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
    },
    {
      command: 'pnpm --filter @nudge/server exec tsx src/index.ts',
      url: 'http://127.0.0.1:4317/health',
      reuseExistingServer: false,
      env: {
        OPENAI_API_KEY: 'sk-test-scripted-planner',
        OPENAI_AGENT_MODEL: env.OPENAI_AGENT_MODEL ?? 'unused-in-scripted-mode',
        NUDGE_PAIRING_SECRET: PAIRING_SECRET,
        NUDGE_PLANNER: 'scripted',
        NUDGE_PLANNER_SCRIPT: `${process.cwd()}/tests/browser/helpers/empty-scenarios.json`,
        NODE_ENV: 'test',
      },
    },
  ],
});
