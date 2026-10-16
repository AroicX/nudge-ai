import { ContentResultSchema, type ContentRequest, type ContentResult } from '@nudge/contracts';

import type { ServerClient } from '../api/server-client';
import { TabRegistry } from '../tabs/tab-registry';
import { createCheckpointPort } from './checkpoint-port';
import type { CdpPort, ContentPort, PlannerPort } from './ports';
import { createScreenshotPort } from './screenshot-port';

/** Thin adapters over chrome.* APIs; exercised by the Playwright acceptance runs. */
export function createChromeContentPort(): ContentPort {
  const sendOnce = async (tabId: number, request: ContentRequest) =>
    ContentResultSchema.parse(await browser.tabs.sendMessage(tabId, request));
  return {
    async send(tabId, request): Promise<ContentResult> {
      try {
        return await sendOnce(tabId, request);
      } catch (error) {
        if (!(error instanceof Error) || !/Receiving end does not exist|Could not establish connection/i.test(error.message)) throw error;
        // Pages opened before install (or restricted reloads) lack the script; the script guards against double injection.
        await browser.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] });
        return sendOnce(tabId, request);
      }
    },
  };
}

export function createChromePlannerPort(client: ServerClient): PlannerPort {
  return {
    scope: (request, signal, provider) => client.scope(request, signal, provider),
    plan: (request, signal, provider) => client.plan(request, signal, provider),
  };
}

export function createChromeTabsPort(): TabRegistry {
  return new TabRegistry(browser.tabs as never);
}

async function measure(dataUrl: string): Promise<{ width: number; height: number }> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export function createChromeScreenshotPort(tabs: TabRegistry, content: ContentPort, cdp?: CdpPort) {
  return createScreenshotPort({
    captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 }),
    windowOf: async (tabId) => (await browser.tabs.get(tabId)).windowId,
    activate: async (tabId) => {
      await tabs.activate(tabId);
    },
    content,
    measure,
    clock: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    id: () => `shot_${crypto.randomUUID()}`,
    cdp,
  });
}

export function createChromeCheckpointPort() {
  return createCheckpointPort(browser.storage.session as never);
}
