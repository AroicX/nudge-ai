import { expect, test } from './helpers/extension';

const routes: Array<[string, string]> = [
  ['/mailbox', 'Inbox'],
  ['/jobs', 'Jobs — page 1 of 3'],
  ['/sheet', 'Job tracker'],
  ['/canvas-editor', 'Flyer'],
  ['/long-scroll', 'A very long article'],
  ['/blocker', 'Join our newsletter'],
];

test('every fixture renders and the extension controller starts idle', async ({ nudge }) => {
  for (const [route, heading] of routes) {
    const { page } = await nudge.open(route);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.close();
  }
  const state = await nudge.state();
  expect(state?.status ?? 'idle').toBe('idle');
});

test('screenshots work through the debugger fallback when captureVisibleTab is refused', async ({ nudge }) => {
  await nudge.open('/long-scroll');
  const result = await nudge.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:4173/long-scroll' });
    const out: Record<string, unknown> = {};
    try {
      await chrome.tabs.captureVisibleTab(tab!.windowId, { format: 'jpeg' });
      out.captureVisibleTab = 'ok';
    } catch (error) {
      out.captureVisibleTab = String(error);
    }
    await chrome.debugger.attach({ tabId: tab!.id! }, '1.3');
    const shot = (await chrome.debugger.sendCommand({ tabId: tab!.id! }, 'Page.captureScreenshot', { format: 'jpeg' })) as { data: string };
    await chrome.debugger.detach({ tabId: tab!.id! });
    out.cdpBytes = shot.data.length;
    return out;
  });
  console.log('screenshot capabilities:', JSON.stringify({ ...result, cdpBytes: Number(result.cdpBytes) > 0 }));
  expect(Number(result.cdpBytes)).toBeGreaterThan(1_000);
});
