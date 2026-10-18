import { test, expect, chromium, type Page } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { ControllerSnapshot } from '@nudge/contracts';

const SERVER = process.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4319';
const ORIGIN = 'https://nudge-ollama.test';
const selection = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:9b' };
const envFile = existsSync('.env') ? '.env' : '.env.example';
const env = parseEnv(readFileSync(path.resolve(envFile), 'utf8'));
const secret = process.env.NUDGE_PAIRING_SECRET ?? env.NUDGE_PAIRING_SECRET;
const headers = { 'x-nudge-pairing-secret': secret ?? '', 'content-type': 'application/json' };

function document(title: string, body: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}

async function state(panel: Page) {
  return panel.evaluate(() =>
    (
      window as unknown as {
        __nudgeTest: { state(): ControllerSnapshot | undefined };
      }
    ).__nudgeTest.state(),
  );
}

const workflows = {
  search: {
    route: 'search',
    instruction:
      'Search this website for Cedar Observatory, open its opening hours result, and tell me its Saturday opening hours.',
  },
  draft: {
    route: 'mail',
    instruction:
      'Compose an email draft to maya.chen@example.test with subject Observatory visit and message exactly: Hi Maya, shall we visit Cedar Observatory this Saturday at 11 AM? Thanks, Alex. Fill in the draft but do not send it.',
  },
  navigation: { route: 'search', instruction: 'Open https://example.com in this tab.' },
  product: {
    route: 'product',
    instruction: 'What is the price and battery life of the product on this page?',
  },
  contact: {
    route: 'contact',
    instruction:
      'Fill this contact form with name Alex Rivera and email alex.rivera@example.test. Do not submit it.',
  },
  correction: {
    route: 'correction',
    instruction:
      'Replace the email address in this form with alex.new@example.test. Leave the name unchanged and do not submit.',
  },
  comparison: {
    route: 'products',
    instruction:
      'Open the details for both Cedar Mini and Cedar Pro on this website and tell me which is cheaper and by how much.',
  },
  calendar: {
    route: 'calendar',
    instruction:
      'Create a draft calendar event titled Cedar visit on October 20, 2026 at 11:00 AM. Fill the calendar form now, but do not save the event.',
  },
  scheduling: { route: 'long', instruction: 'In 1 minute, open https://example.com' },
  cancellation: { route: 'long', instruction: 'In 1 minute, scroll this page down.' },
  recall: {
    route: 'contact',
    instruction: 'Fill this contact form with my saved name and email address. Do not submit it.',
  },
} as const;

for (const workflow of Object.keys(workflows) as Array<keyof typeof workflows>) {
  test(`real local Ollama completes the ${workflow} workflow in Chromium`, async ({
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'ollama-live',
      'Run with playwright.ollama.config.ts to opt in to real local model inference.',
    );
    // A scripted backend must never accidentally make this live-model regression pass.
    const scripted = await request.get(`${SERVER}/api/test/planner-log`, { headers });
    expect(
      scripted.status(),
      'Run the normal live backend, not the scripted acceptance backend',
    ).toBe(404);
    const configured = await request.put(`${SERVER}/api/settings/provider`, {
      headers,
      data: selection,
    });
    expect(configured.ok()).toBe(true);

    const extension = mkdtempSync(path.join(tmpdir(), 'nudge-ollama-extension-'));
    cpSync(path.resolve('apps/extension/.output-e2e/chrome-mv3'), extension, { recursive: true });
    const executablePath =
      process.env.NUDGE_CHROMIUM_PATH ??
      [
        chromium.executablePath(),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ].find(existsSync);
    const context = await chromium.launchPersistentContext('', {
      executablePath,
      headless: process.env.NUDGE_OLLAMA_HEADLESS === '1',
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        ...(process.env.NUDGE_OLLAMA_HEADLESS === '1' ? ['--headless=new'] : []),
      ],
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const submitted: string[] = [];
    const visited: string[] = [];
    const startedAt = Date.now();
    const plannerRequests: Array<{ url: string; provider?: string; elapsedMs: number }> = [];
    context.on('request', (request) => {
      if (request.url().includes('/api/agent/'))
        plannerRequests.push({
          url: request.url(),
          provider: request.headers()['x-nudge-provider'],
          elapsedMs: Date.now() - startedAt,
        });
    });
    // Abort unpinned requests before they can reach a shared backend default.
    await context.route(`${SERVER}/api/agent/**`, async (route) => {
      if (route.request().headers()['x-nudge-provider'] !== 'ollama')
        return route.abort('blockedbyclient');
      await route.continue();
    });
    const searches: string[] = [];
    const browserErrors: string[] = [];
    context.on('weberror', (event) => browserErrors.push(event.error().message));
    context.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    let panel: Page | undefined;
    try {
      // Only website content is deterministic. Navigation, DOM interaction, extension,
      // authenticated backend, planner, and model inference are all real.
      await context.route(`${ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        visited.push(url.pathname);
        let body: string;
        if (url.pathname === '/search') {
          const query = url.searchParams.get('q');
          if (query) searches.push(query);
          body = query
            ? document(
                'Search results',
                `<p>Results for ${query}</p><a href="/article/cedar">Cedar Observatory opening hours</a><p>Visitor information and admission.</p>`,
              )
            : document(
                'Observatory directory',
                '<form action="/search" method="get"><label>Search observatories <input name="q" type="search"></label><button type="submit">Search</button></form>',
              );
        } else if (url.pathname === '/article/cedar') {
          body = document(
            'Cedar Observatory opening hours',
            '<p>The Cedar Observatory is open Saturdays from 10:30 AM to 4:00 PM. Admission is free.</p>',
          );
        } else if (url.pathname === '/mail') {
          body = document(
            'Mail inbox',
            '<p>No new messages.</p><a href="/compose">Compose email</a>',
          );
        } else if (url.pathname === '/compose') {
          body = document(
            'New email draft',
            '<form action="/sent" method="get"><label>To <input name="to" type="email"></label><label>Subject <input name="subject"></label><label>Message <textarea name="message"></textarea></label><button type="submit">Send email</button></form><p>Your draft remains here until you send it.</p>',
          );
        } else if (url.pathname === '/product') {
          body = document(
            'Cedar Mini portable speaker',
            '<p>Price: $49. Battery life: 12 hours.</p>',
          );
        } else if (url.pathname === '/contact' || url.pathname === '/correction') {
          const correction = url.pathname === '/correction';
          body = document(
            'Contact form',
            `<form action="/sent"><label>Name <input name="name" value="${correction ? 'Sam Lee' : ''}"></label><label>Email <input name="email" type="email" value="${correction ? 'sam.old@example.test' : ''}"></label><button type="submit">Submit contact</button></form>`,
          );
        } else if (url.pathname === '/products') {
          body = document(
            'Cedar speaker catalogue',
            '<a href="/products/mini">Cedar Mini details</a><a href="/products/pro">Cedar Pro details</a>',
          );
        } else if (url.pathname === '/products/mini' || url.pathname === '/products/pro') {
          body = document(
            url.pathname.endsWith('mini') ? 'Cedar Mini' : 'Cedar Pro',
            `<p>Price: $${url.pathname.endsWith('mini') ? '49' : '79'}.</p><a href="/products">Back to catalogue</a>`,
          );
        } else if (url.pathname === '/calendar') {
          body = document(
            'Calendar event draft',
            '<form action="/sent"><label>Event title <input name="title"></label><label>Date <input name="date" type="date"></label><label>Time <input name="time" type="time"></label><button type="submit">Save event</button></form>',
          );
        } else if (url.pathname === '/long') {
          body = document(
            'Long reading page',
            Array.from(
              { length: 100 },
              (_, index) => `<section style="height:200px">Reading section ${index + 1}</section>`,
            ).join(''),
          );
        } else if (url.pathname === '/sent') {
          submitted.push(url.href);
          body = document('Email sent', '<p>Submission recorded.</p>');
        } else {
          return route.fulfill({ status: 404, body: 'Not found' });
        }
        await route.fulfill({ contentType: 'text/html', body });
      });
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await worker.evaluate(async (providerSelection) => {
        await chrome.storage.local.set({ providerSelection, providerVision: false });
      }, selection);
      panel = await context.newPage();
      const providerReady = panel.waitForResponse(
        (response) =>
          response.url() === `${SERVER}/api/settings/provider` &&
          response.request().method() === 'PUT' &&
          response.ok(),
      );
      await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html`);
      await panel.waitForFunction(() =>
        Boolean((window as unknown as { __nudgeTest?: unknown }).__nudgeTest),
      );
      await providerReady;
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/${workflows[workflow].route}`);
      const initialObservation = await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find((tab) => tab.url === url);
        if (target?.id === undefined) throw new Error('Fixture tab missing');
        const observation = await chrome.tabs.sendMessage(target.id, { type: 'observe' });
        return { tabs, observation };
      }, page.url());
      await testInfo.attach('initial-browser-observation', {
        body: JSON.stringify(initialObservation, null, 2),
        contentType: 'application/json',
      });
      expect(initialObservation.observation.snapshot?.url).toBe(page.url());
      if (['recall', 'scheduling', 'cancellation'].includes(workflow)) {
        const sourceTabId = initialObservation.tabs.find((tab) => tab.url === page.url())?.id;
        const fullPageReady = panel.waitForResponse(
          (response) =>
            response.url() === `${SERVER}/api/settings/provider` &&
            response.request().method() === 'PUT' &&
            response.ok(),
        );
        await panel.goto(
          `chrome-extension://${new URL(worker.url()).host}/sidepanel.html?view=fullpage&sourceTabId=${sourceTabId}`,
        );
        await fullPageReady;
      }
      if (workflow === 'recall') {
        await panel.getByRole('button', { name: 'Memory & profile', exact: true }).click();
        for (const [key, value] of [
          ['name', 'Jordan Vale'],
          ['email', 'jordan.vale@example.test'],
        ]) {
          await panel.getByLabel('Detail name', { exact: true }).fill(key!);
          await panel.getByLabel('What should Nudge remember?').fill(value!);
          await panel.getByRole('button', { name: 'Save detail', exact: true }).click();
          await expect(panel.locator('.memory-list')).toContainText(value!);
        }
        await panel.getByRole('button', { name: 'Close memory', exact: true }).click();
      }
      const instruction = workflows[workflow].instruction;
      // Use the visible composer and the actual active-tab selection.
      await panel
        .getByRole('textbox', { name: 'Tell Nudge what to do', exact: true })
        .fill(instruction);
      await panel.getByRole('button', { name: 'Send message', exact: true }).click();
      const assertLocal = async () => {
        const saved = await worker.evaluate(
          async () => (await chrome.storage.local.get('providerSelection')).providerSelection,
        );
        expect(saved).toEqual(selection);
        expect(
          plannerRequests.every((request) => request.provider === 'ollama'),
          'Every browser decision must pin Ollama explicitly; shared backend defaults may change',
        ).toBe(true);
        expect((await state(panel!))?.fallbackOffer).toBeUndefined();
      };
      if (workflow === 'scheduling' || workflow === 'cancellation') {
        const scheduled = panel.locator('.scheduled-tasks');
        await expect(scheduled).toContainText('1 pending');
        await expect(scheduled).toContainText('Ollama');
        await expect(scheduled).toContainText('nudge-ollama.test');
        await expect(
          scheduled.getByRole('button', { name: /^Cancel scheduled task/ }),
        ).toBeVisible();
        expect(await page.evaluate(() => scrollY)).toBe(0);
        if (workflow === 'scheduling') {
          await expect(page).toHaveURL('https://example.com/', { timeout: 100_000 });
          await expect(
            page.getByText('This domain is for use in documentation examples', { exact: false }),
          ).toBeVisible();
          await expect(scheduled).toContainText('completed');
        }
        if (workflow === 'cancellation') {
          await scheduled.getByRole('button', { name: /^Cancel scheduled task/ }).click();
          await expect(scheduled).toContainText('cancelled');
          await page.waitForTimeout(65_000);
          expect(await page.evaluate(() => scrollY)).toBe(0);
          expect((await state(panel))?.status ?? 'idle').toBe('idle');
        }
        await assertLocal();
        return;
      }
      await expect
        .poll(async () => (await state(panel!))?.status ?? 'idle', {
          timeout: 15_000,
          message:
            'An explicit browser instruction must start the browser controller, not ordinary chat',
        })
        .not.toBe('idle');
      await expect
        .poll(async () => (await state(panel!))?.status, {
          timeout: 540_000,
          message: 'The live model must finish the requested browser work',
        })
        .toMatch(
          /^(completed|partially_completed|failed|waiting_for_user|waiting_for_confirmation)$/,
        );
      const final = await state(panel);
      await testInfo.attach('controller-state', {
        body: JSON.stringify(final, null, 2),
        contentType: 'application/json',
      });
      expect(final?.status, JSON.stringify(final, null, 2)).toBe('completed');
      if (workflow === 'search') {
        expect(searches.some((query) => /cedar observatory/i.test(query))).toBe(true);
        await expect(page).toHaveURL(`${ORIGIN}/article/cedar`);
        expect(JSON.stringify(final?.report)).toMatch(/10:30/);
        expect(JSON.stringify(final?.report)).toMatch(/4:00|16:00/);
        const steps = JSON.stringify(final?.timeline);
        expect(steps).toMatch(/search|type|fill/i);
      } else if (workflow === 'draft') {
        await expect(page).toHaveURL(`${ORIGIN}/compose`);
        await expect(page.getByRole('textbox', { name: 'To', exact: true })).toHaveValue(
          'maya.chen@example.test',
        );
        await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(
          'Observatory visit',
        );
        await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
          'Hi Maya, shall we visit Cedar Observatory this Saturday at 11 AM? Thanks, Alex.',
        );
      }
      if (workflow === 'navigation') {
        await expect(page).toHaveURL('https://example.com/');
        await expect(
          page.getByText('This domain is for use in documentation examples', { exact: false }),
        ).toBeVisible();
      } else if (workflow === 'product') {
        expect(final?.report?.summary).toMatch(/49/);
        expect(final?.report?.summary).toMatch(/12/);
      } else if (workflow === 'contact') {
        await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
          'Alex Rivera',
        );
        await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
          'alex.rivera@example.test',
        );
      } else if (workflow === 'recall') {
        await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
          'Jordan Vale',
        );
        await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
          'jordan.vale@example.test',
        );
      } else if (workflow === 'correction') {
        await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
          'Sam Lee',
        );
        await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
          'alex.new@example.test',
        );
      } else if (workflow === 'calendar') {
        await expect(page.getByRole('textbox', { name: 'Event title', exact: true })).toHaveValue(
          'Cedar visit',
        );
        await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-20');
        await expect(page.getByLabel('Time', { exact: true })).toHaveValue('11:00');
        await expect(panel.locator('.scheduled-tasks')).toHaveCount(0);
      } else if (workflow === 'comparison') {
        expect(visited).toContain('/products/mini');
        expect(visited).toContain('/products/pro');
        expect(final?.report?.summary).toMatch(/Cedar Mini/i);
        expect(final?.report?.summary).toMatch(/30/);
      }
      await assertLocal();
      expect(submitted, 'Drafting and filling must never submit').toEqual([]);
    } finally {
      await testInfo.attach('scenario-duration', {
        body: JSON.stringify({
          scenario: workflow,
          elapsedMs: Date.now() - startedAt,
          browser: context.browser()?.version() ?? 'Chromium persistent context',
          plannerRequests,
          provider: selection,
          fixtureOrigin: ORIGIN,
        }),
        contentType: 'application/json',
      });
      if (panel && !panel.isClosed()) {
        await testInfo.attach('last-controller-state', {
          body: JSON.stringify(await state(panel), null, 2) ?? 'null',
          contentType: 'application/json',
        });
      }
      await testInfo.attach('browser-errors', {
        body: JSON.stringify(browserErrors, null, 2),
        contentType: 'application/json',
      });
      await context.tracing.stop({ path: testInfo.outputPath('trace.zip') });
      await context.close();
      rmSync(extension, { recursive: true, force: true });
    }
  });
}
