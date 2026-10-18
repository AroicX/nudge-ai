import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ControllerSnapshot } from '@nudge/contracts';

for (const instruction of ['Open YouTube', 'Can you open YouTube now?']) {
  test(`opens from a Chrome new tab through the real panel composer: ${instruction}`, async () => {
    const extension = path.resolve('apps/extension/.output-e2e/chrome-mv3');
    const executablePath = [
      chromium.executablePath(),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].find(existsSync);
    const context = await chromium.launchPersistentContext('', {
      executablePath,
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--headless=new',
      ],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const panel = await context.newPage();
      await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
      await panel.waitForFunction(() =>
        Boolean(
          (window as unknown as { __nudgeTest: { state(): ControllerSnapshot } }).__nudgeTest,
        ),
      );
      // Only content is stubbed: the actual Chrome tab API performs and reports the navigation.
      await context.route('https://www.youtube.com/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<title>YouTube</title><h1>YouTube</h1>',
        }),
      );
      await worker.evaluate(async () => {
        await chrome.tabs.create({ url: 'chrome://newtab/', active: true });
      });
      await panel.getByRole('textbox').fill(instruction);
      await panel.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect
        .poll(async () =>
          panel.evaluate(
            () =>
              (
                window as unknown as { __nudgeTest: { state(): ControllerSnapshot } }
              ).__nudgeTest.state()?.status,
          ),
        )
        .toBe('completed');
      const state: ControllerSnapshot = await panel.evaluate(() =>
        (window as unknown as { __nudgeTest: { state(): ControllerSnapshot } }).__nudgeTest.state(),
      );
      expect(state.sources?.[0]?.url).toBe('https://www.youtube.com/');
      const destination = await worker.evaluate(async () =>
        (await chrome.tabs.query({})).find((tab) => tab.url === 'https://www.youtube.com/'),
      );
      expect(destination?.id).toBe(state.sources?.[0]?.tabId);
    } finally {
      await context.close();
    }
  });
}
