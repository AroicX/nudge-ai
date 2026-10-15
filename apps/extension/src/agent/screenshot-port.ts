import type { ContentRequest, ContentResult, PageSnapshot } from '@nudge/contracts';

import type { ScreenshotPort } from './ports';

const MIN_INTERVAL_MS = 500; // Chrome allows at most 2 captureVisibleTab calls per second.

export interface ScreenshotDeps {
  captureVisibleTab(windowId: number): Promise<string>;
  windowOf(tabId: number): Promise<number>;
  activate(tabId: number): Promise<void>;
  content: { send(tabId: number, request: ContentRequest): Promise<ContentResult> };
  measure(dataUrl: string): Promise<{ width: number; height: number }>;
  clock(): number;
  sleep(ms: number): Promise<void>;
  id(): string;
  cdp?: { attachedTabId(): number | undefined; attach(tabId: number): Promise<void>; captureScreenshot(): Promise<string> } | undefined;
}

export function createScreenshotPort(deps: ScreenshotDeps): ScreenshotPort {
  let last = -Infinity;
  return {
    async capture(tabId: number, snapshot: PageSnapshot) {
      // captureVisibleTab only sees the active tab of a window.
      await deps.activate(tabId);
      await deps.content.send(tabId, { type: 'cursor_hide' }).catch(() => undefined);
      const wait = MIN_INTERVAL_MS - (deps.clock() - last);
      if (wait > 0) await deps.sleep(wait);
      last = deps.clock();
      let dataUrl: string;
      try {
        dataUrl = await deps.captureVisibleTab(await deps.windowOf(tabId));
      } catch (error) {
        // captureVisibleTab needs <all_urls> or a user-invoked activeTab grant; fall back to the
        // debugger session on the same tab (verified empirically in Chromium 1194).
        if (!deps.cdp) throw error;
        if (deps.cdp.attachedTabId() !== tabId) await deps.cdp.attach(tabId);
        dataUrl = await deps.cdp.captureScreenshot();
      }
      const size = await deps.measure(dataUrl);
      return {
        dataUrl,
        frame: {
          screenshotId: deps.id(),
          tabId,
          documentId: snapshot.documentId,
          url: snapshot.url,
          capturedAt: deps.clock(),
          viewport: {
            cssWidth: snapshot.viewport.width,
            cssHeight: snapshot.viewport.height,
            devicePixelRatio: size.width > 0 ? size.width / snapshot.viewport.width : 1,
            scrollX: snapshot.viewport.scrollX,
            scrollY: snapshot.viewport.scrollY,
          },
          imageWidth: size.width,
          imageHeight: size.height,
          coordinateSpace: 'css_viewport',
          mutationCounterAtCapture: snapshot.mutationCounter ?? 0,
        },
      };
    },
  };
}
