import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

import type { ControllerSnapshot } from '@nudge/contracts';

const ROOT = path.resolve(process.cwd());
const EXTENSION = path.join(ROOT, 'apps/extension/.output-e2e/chrome-mv3');
const SERVER = 'http://127.0.0.1:4317';
const FIXTURES = 'http://127.0.0.1:4173';
const envFile = existsSync(path.join(ROOT, '.env')) ? path.join(ROOT, '.env') : path.join(ROOT, '.env.example');
const SECRET = (parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>).NUDGE_PAIRING_SECRET ?? '';
const CHROMIUM =
  process.env.NUDGE_CHROMIUM_PATH ??
  [
    chromium.executablePath(),
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find((candidate) => existsSync(candidate));

export interface NudgeHarness {
  context: BrowserContext;
  worker: Worker;
  panel: Page;
  open(route: string): Promise<{ page: Page; tabId: number }>;
  tabIdOf(page: Page): Promise<number>;
  scenario(file: unknown): Promise<void>;
  instruct(text: string, originTabId: number): Promise<void>;
  injectTranscript(text: string): Promise<void>;
  state(): Promise<ControllerSnapshot | undefined>;
  waitForStatus(statuses: string[], timeoutMs?: number): Promise<ControllerSnapshot>;
  plannerLog(): Promise<Array<{ kind: string; request: Record<string, unknown> }>>;
  sentToContent(): Promise<unknown[]>;
}

async function api(method: string, route: string, body?: unknown) {
  const response = await fetch(`${SERVER}${route}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-nudge-pairing-secret': SECRET },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${route} → ${response.status}`);
  return response.json();
}

export const test = base.extend<{ nudge: NudgeHarness }>({
  // eslint-disable-next-line no-empty-pattern
  nudge: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--headless=new'],
    });
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await api('PUT', '/api/test/scenarios', { scenarios: [] });

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForFunction(() => Boolean((window as unknown as { __nudgeTest?: unknown }).__nudgeTest));

    const tabIdOf = async (page: Page) => {
      const url = page.url();
      const id = await worker.evaluate(async (target) => {
        const tabs = await chrome.tabs.query({});
        return tabs.find((tab) => tab.url === target)?.id;
      }, url);
      if (id === undefined) throw new Error(`No tab for ${url}`);
      return id;
    };

    const harness: NudgeHarness = {
      context,
      worker,
      panel,
      async open(route) {
        const page = await context.newPage();
        await page.goto(`${FIXTURES}${route}`);
        await page.waitForLoadState('domcontentloaded');
        return { page, tabId: await tabIdOf(page) };
      },
      tabIdOf,
      async scenario(file) {
        await api('PUT', '/api/test/scenarios', file);
      },
      async instruct(text, originTabId) {
        await panel.evaluate(
          ([value, origin]) => (window as unknown as { __nudgeTest: { instruct(t: string, o: number): void } }).__nudgeTest.instruct(value as string, origin as number),
          [text, originTabId] as const,
        );
      },
      async injectTranscript(text) {
        await panel.evaluate((value) => (window as unknown as { __nudgeTest: { injectTranscript(t: string): void } }).__nudgeTest.injectTranscript(value), text);
      },
      async state() {
        return panel.evaluate(() => (window as unknown as { __nudgeTest: { state(): unknown } }).__nudgeTest.state() as ControllerSnapshot | undefined);
      },
      async waitForStatus(statuses, timeoutMs = 60_000) {
        const deadline = Date.now() + timeoutMs;
        let last: ControllerSnapshot | undefined;
        while (Date.now() < deadline) {
          last = await harness.state();
          if (last && statuses.includes(last.status)) return last;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        throw new Error(`Timed out waiting for ${statuses.join('|')}; last state: ${JSON.stringify(last, null, 1)?.slice(0, 3_000)}`);
      },
      async plannerLog() {
        return api('GET', '/api/test/planner-log');
      },
      async sentToContent() {
        return [];
      },
    };
    await use(harness);
    await context.close();
  },
});

export { expect };
