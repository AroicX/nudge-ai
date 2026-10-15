import type { PageSnapshot } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { TabRegistry } from '../tabs/tab-registry';
import { createCheckpointPort } from './checkpoint-port';
import { createScreenshotPort } from './screenshot-port';

const snapshot: PageSnapshot = {
  snapshotId: 's', documentId: 'doc_1', capturedAt: '2026-10-15T18:00:00.000Z', url: 'http://127.0.0.1:4173/long-scroll', title: 't',
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 40, pageHeight: 20000 },
  elements: [], text: [], truncated: false, inaccessible: [], mutationCounter: 3,
};

function screenshotDeps() {
  let now = 1_000;
  const log: string[] = [];
  const deps = {
    captureVisibleTab: vi.fn(async () => {
      log.push('capture');
      return 'data:image/jpeg;base64,AAAA';
    }),
    windowOf: vi.fn(async () => 7),
    activate: vi.fn(async () => {
      log.push('activate');
    }),
    content: { send: vi.fn(async (_tab: number, request: { type: string }) => {
      log.push(request.type);
      return { ok: true, detail: '', changed: false, documentId: 'doc_1' };
    }) },
    measure: vi.fn(async () => ({ width: 2000, height: 1600 })),
    clock: () => now,
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
    id: () => 'shot_1',
  };
  return { deps, log, advance: (ms: number) => (now += ms) };
}

describe('screenshot port', () => {
  it('hides the cursor before capture and records frame metadata', async () => {
    const { deps, log } = screenshotDeps();
    const port = createScreenshotPort(deps);
    const result = await port.capture(4, snapshot);
    expect(log).toEqual(['activate', 'cursor_hide', 'capture']);
    expect(result.frame).toMatchObject({
      screenshotId: 'shot_1', tabId: 4, documentId: 'doc_1', url: snapshot.url,
      viewport: { cssWidth: 1000, cssHeight: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 40 },
      imageWidth: 2000, imageHeight: 1600, coordinateSpace: 'css_viewport', mutationCounterAtCapture: 3,
    });
  });

  it('throttles to at most 2 captures per second', async () => {
    const { deps, advance } = screenshotDeps();
    const port = createScreenshotPort(deps);
    await port.capture(4, snapshot);
    advance(100);
    await port.capture(4, snapshot);
    expect(deps.sleep).toHaveBeenCalledWith(400);
  });

  it('falls back to the debugger screenshot when capture fails and a session is attached', async () => {
    const { deps } = screenshotDeps();
    deps.captureVisibleTab.mockRejectedValueOnce(new Error('Missing host permission'));
    const cdp = { attachedTabId: () => 4, captureScreenshot: vi.fn(async () => 'data:image/png;base64,BBBB') };
    const port = createScreenshotPort({ ...deps, cdp });
    const result = await port.capture(4, snapshot);
    expect(result.dataUrl).toBe('data:image/png;base64,BBBB');
  });
});

describe('checkpoint port', () => {
  it('round-trips through storage.session', async () => {
    const store = new Map<string, unknown>();
    const area = {
      get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) store.set(key, value);
      }),
      remove: vi.fn(async (key: string) => void store.delete(key)),
    };
    const port = createCheckpointPort(area);
    expect(await port.load()).toBeUndefined();
    const checkpoint = { version: 1 as const, taskId: 't', status: 'running' as const, memory: { goal: 'g', constraints: [], userData: [], plan: [], steps: [], tabs: [], recordFields: [], recordCount: 0, sources: [], issues: [] }, authorization: { taskId: 't', instruction: 'g', origins: [], categories: ['read' as const], destinations: [], exclusions: [], limits: {} }, records: [], generation: 0, instructionVersion: 0 };
    await port.save(checkpoint);
    expect(await port.load()).toEqual(checkpoint);
    await port.clear();
    expect(await port.load()).toBeUndefined();
  });
});

describe('TabRegistry navigation', () => {
  function api() {
    const updated = new Set<(id: number, info: { status?: string; url?: string }) => void>();
    const tabs = [{ id: 1, windowId: 1, active: true, url: 'https://a.test/', title: 'A', status: 'complete' }];
    return {
      query: vi.fn(async () => tabs),
      get: vi.fn(async (id: number) => tabs.find((tab) => tab.id === id)),
      update: vi.fn(async (id: number, props: { url?: string; active?: boolean }) => {
        const tab = tabs.find((candidate) => candidate.id === id)!;
        if (props.url) {
          tab.status = 'loading';
          setTimeout(() => {
            tab.url = props.url!;
            tab.status = 'complete';
            updated.forEach((listener) => listener(id, { status: "complete", url: props.url! }));
          }, 20);
        }
        return tab;
      }),
      create: vi.fn(),
      remove: vi.fn(async () => undefined),
      goBack: vi.fn(async () => undefined),
      goForward: vi.fn(async () => undefined),
      reload: vi.fn(async () => undefined),
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: {
        addListener: (listener: (id: number, info: { status?: string; url?: string }) => void) => updated.add(listener),
        removeListener: (listener: (id: number, info: { status?: string; url?: string }) => void) => updated.delete(listener),
      },
    };
  }

  it('refuses to close an unknown tab', async () => {
    const tabs = api();
    const registry = new TabRegistry(tabs as never);
    await expect(registry.close(99)).rejects.toThrow(/not available/);
    expect(tabs.remove).not.toHaveBeenCalled();
  });

  it('navigates and waits for the page to complete', async () => {
    const tabs = api();
    const registry = new TabRegistry(tabs as never);
    await registry.list();
    await registry.navigate(1, 'https://a.test/next');
    expect((await tabs.get(1))!.status).toBe('complete');
    expect((await tabs.get(1))!.url).toBe('https://a.test/next');
  });

  it('rejects non-http navigation', async () => {
    const registry = new TabRegistry(api() as never);
    await registry.list();
    await expect(registry.navigate(1, 'javascript:alert(1)')).rejects.toThrow(/HTTP/);
  });
});
