import { describe, expect, it, vi } from 'vitest';
import {
  executeNativeBrowserCommand as execute,
  parseNativeBrowserCommand as parse,
  type BrowserApi,
  type BrowserTab,
  type BrowserWindow,
} from './native-browser';

function fixture() {
  const tabs: BrowserTab[] = [
    {
      id: 10,
      url: 'https://one.test',
      windowId: 2,
      index: 0,
      pinned: false,
      groupId: -1,
      mutedInfo: { muted: false },
    },
    { id: 11, url: 'https://two.test', windowId: 2, index: 1, pinned: false, groupId: -1 },
    { id: 99, windowId: 9, index: 0 },
  ];
  const windows: BrowserWindow[] = [
    { id: 2, state: 'normal', left: 0, top: 0, width: 900, height: 700 },
  ];
  let zoom = 1;
  const api: BrowserApi = {
    tabs: {
      get: vi.fn(async (id) => {
        const tab = tabs.find((tab) => tab.id === id);
        if (!tab) throw new Error('Missing tab');
        return { ...tab };
      }),
      query: vi.fn(async (query) =>
        tabs.filter((tab) =>
          query.currentWindow ? tab.id === 99 : tab.windowId === query.windowId,
        ),
      ),
      getZoom: vi.fn(async () => zoom),
      setZoom: vi.fn(async (_id, factor) => {
        zoom = factor || 1.25;
      }),
      update: vi.fn(async (id, changes) => {
        const tab = tabs.find((tab) => tab.id === id)!;
        if (changes.pinned !== undefined) tab.pinned = changes.pinned;
        if (changes.muted !== undefined) tab.mutedInfo = { muted: changes.muted };
        return tab;
      }),
      group: vi.fn(async ({ tabIds }) => {
        tabs.find((tab) => tab.id === tabIds[0])!.groupId = 7;
        return 7;
      }),
      ungroup: vi.fn(async (ids) => {
        tabs.find((tab) => tab.id === ids[0])!.groupId = -1;
      }),
      reload: vi.fn(async () => {}),
      goBack: vi.fn(async () => {}),
      goForward: vi.fn(async () => {}),
    },
    windows: {
      get: vi.fn(async (id) => ({ ...windows.find((window) => window.id === id)! })),
      update: vi.fn(async (id, changes) =>
        Object.assign(
          windows.find((window) => window.id === id)!,
          changes,
        ),
      ),
      create: vi.fn(async ({ tabId, type: _type, ...bounds }) => {
        const window = { id: 3, ...bounds };
        windows.push(window);
        tabs.find((tab) => tab.id === tabId)!.windowId = 3;
        return window;
      }),
    },
  };
  return { api, tabs, windows };
}
const area = { left: -1600, top: 24, width: 1600, height: 1000 };

describe('native browser command parser', () => {
  it.each([
    'zoom in',
    'Please zoom out.',
    'zoom to 125%',
    'reset zoom',
    'enter fullscreen',
    'exit full screen',
    'maximize the window',
    'minimize',
    'split two tabs side by side',
    'stack two tabs vertically',
    'pin this tab',
    'unmute',
    'go back',
    'go forward',
    'split screen',
    'split the screen',
    'split tabs',
    'stack screens',
    'stack windows',
    'Could you zoom in?',
    'unsplit tabs',
  ])('accepts explicit command %s', (text) => expect(parse(text)).toBeDefined());
  it.each([
    'How do I zoom in?',
    'do not zoom in',
    'The page says zoom in',
    'zoom in and buy it',
    'zoom to 900%',
    'zoom to 0%',
    'send zoom in to Alice',
    '"zoom in"',
    'split tabs side by side and close the rest',
    'zoom in on the price',
  ])('does not hijack ordinary or compound instructions %s', (text) =>
    expect(parse(text)).toBeUndefined(),
  );
});

describe('native browser execution', () => {
  it('does not mutate after cancellation during screen discovery', async () => {
    const { api } = fixture();
    const abort = new AbortController();
    await expect(
      execute({ kind: 'arrange', layout: 'stacked' }, 10, api, {
        signal: abort.signal,
        getWorkArea: () => {
          abort.abort();
          return area;
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.windows.create).not.toHaveBeenCalled();
    expect(api.windows.update).not.toHaveBeenCalled();
  });
  it('stops remaining window mutations after cancellation during window creation', async () => {
    const { api } = fixture();
    const abort = new AbortController();
    const create = api.windows.create;
    api.windows.create = vi.fn(async (options) => {
      const result = await create(options);
      abort.abort();
      return result;
    });
    await expect(
      execute({ kind: 'arrange', layout: 'stacked' }, 10, api, {
        signal: abort.signal,
        getWorkArea: () => area,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.windows.create).toHaveBeenCalledOnce();
    expect(api.windows.update).not.toHaveBeenCalled();
  });
  it('does not report success if cancelled during verification', async () => {
    const { api } = fixture();
    const abort = new AbortController();
    api.tabs.getZoom = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockImplementationOnce(async () => {
        abort.abort();
        return 1.5;
      });
    await expect(
      execute({ kind: 'zoom', value: 150 }, 10, api, { signal: abort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('zooms the explicit linked tab even when another window is active', async () => {
    const { api } = fixture();
    expect(await execute({ kind: 'zoom', value: 'in' }, 10, api)).toBe('Page zoom is 110%.');
    expect(api.tabs.setZoom).toHaveBeenCalledWith(10, 1.1);
    expect(api.tabs.query).not.toHaveBeenCalled();
    expect(await execute({ kind: 'zoom', value: 'out' }, 10, api)).toBe('Page zoom is 100%.');
    expect(await execute({ kind: 'zoom', value: 'reset' }, 10, api)).toBe('Page zoom is 125%.');
    expect(api.tabs.setZoom).toHaveBeenLastCalledWith(10, 0);
    expect(await execute({ kind: 'zoom', value: 150 }, 10, api)).toBe('Page zoom is 150%.');
  });
  it('detects a browser ignoring zoom and never falls back from a missing explicit tab', async () => {
    const { api } = fixture();
    api.tabs.setZoom = vi.fn(async () => {});
    await expect(execute({ kind: 'zoom', value: 150 }, 10, api)).rejects.toThrow('did not apply');
    await expect(execute({ kind: 'zoom', value: 'in' }, 100, api)).rejects.toThrow('Missing tab');
    expect(api.tabs.query).not.toHaveBeenCalled();
  });
  it('resolves active tab only when no linked tab is supplied', async () => {
    const { api } = fixture();
    await execute({ kind: 'zoom', value: 150 }, undefined, api);
    expect(api.tabs.setZoom).toHaveBeenCalledWith(99, 1.5);
  });
  it.each(['fullscreen', 'normal', 'maximized', 'minimized'] as const)(
    'verifies %s in the linked window',
    async (state) => {
      const { api } = fixture();
      await execute({ kind: 'window', state }, 10, api);
      expect(api.windows.update).toHaveBeenCalledWith(2, { state });
      api.windows.update = vi.fn(async () => ({ id: 2, state: 'bogus' }));
      api.windows.get = vi.fn(async () => ({ id: 2, state: 'bogus' }));
      await expect(execute({ kind: 'window', state }, 10, api)).rejects.toThrow('did not apply');
    },
  );
  it('uses native split only for an eligible same-window pair and verifies membership', async () => {
    const { api, tabs } = fixture();
    api.tabs.createSplit = vi.fn(async (ids) => {
      for (const tab of tabs) if (ids.includes(tab.id!)) tab.splitViewId = 5;
      return 5;
    });
    expect(await execute({ kind: 'arrange', layout: 'side-by-side' }, 10, api)).toContain(
      'browser split view',
    );
    expect(api.tabs.createSplit).toHaveBeenCalledWith([10, 11]);
    expect(api.windows.create).not.toHaveBeenCalled();
    tabs[0]!.splitViewId = -1;
    tabs[1]!.splitViewId = -1;
    api.tabs.createSplit = vi.fn(async () => 6);
    await expect(execute({ kind: 'arrange', layout: 'side-by-side' }, 10, api)).rejects.toThrow(
      'did not confirm',
    );
  });
  it.each(['side-by-side', 'stacked'] as const)(
    'tiles %s using the supplied monitor work area',
    async (layout) => {
      const { api } = fixture();
      const getWorkArea = vi.fn(() => area);
      expect(await execute({ kind: 'arrange', layout }, 10, api, { getWorkArea })).toContain(
        'separate windows',
      );
      expect(getWorkArea).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
      expect(api.windows.create).toHaveBeenCalledWith(
        expect.objectContaining(
          layout === 'stacked'
            ? { left: -1600, top: 524, width: 1600, height: 500, tabId: 11 }
            : { left: -800, top: 24, width: 800, height: 1000, tabId: 11 },
        ),
      );
      expect(api.windows.update).toHaveBeenCalledWith(2, { state: 'normal' });
    },
  );
  it('refuses ambiguous pairs and missing screen area without moving tabs', async () => {
    const { api, tabs } = fixture();
    await expect(execute({ kind: 'arrange', layout: 'stacked' }, 10, api)).rejects.toThrow(
      'screen dimensions',
    );
    tabs.push({ id: 12, url: 'https://three.test', windowId: 2, index: 2 });
    await expect(
      execute({ kind: 'arrange', layout: 'stacked' }, 10, api, { getWorkArea: () => area }),
    ).rejects.toThrow('exactly two web tabs');
    expect(api.windows.create).not.toHaveBeenCalled();
  });
  it('falls back rather than illegally splitting pinned/group-mismatched tabs', async () => {
    const { api, tabs } = fixture();
    tabs[1]!.pinned = true;
    api.tabs.createSplit = vi.fn(async () => 5);
    await execute({ kind: 'arrange', layout: 'side-by-side' }, 10, api, {
      getWorkArea: () => area,
    });
    expect(api.tabs.createSplit).not.toHaveBeenCalled();
  });
  it('ignores the extension chat and internal pages when selecting web tabs', async () => {
    const { api, tabs } = fixture();
    tabs.push(
      { id: 12, windowId: 2, index: 2, url: 'chrome-extension://id/fullpage.html' },
      { id: 13, windowId: 2, index: 3, url: 'chrome://settings' },
    );
    await execute({ kind: 'arrange', layout: 'stacked' }, 10, api, { getWorkArea: () => area });
    expect(api.windows.create).toHaveBeenCalledWith(expect.objectContaining({ tabId: 11 }));
  });
  it('accepts exactly two explicitly selected web tabs including the linked tab', async () => {
    const { api, tabs } = fixture();
    tabs[0]!.highlighted = true;
    tabs[1]!.highlighted = true;
    tabs.push({ id: 12, windowId: 2, index: 2, url: 'https://three.test' });
    await execute({ kind: 'arrange', layout: 'stacked' }, 10, api, { getWorkArea: () => area });
    expect(api.windows.create).toHaveBeenCalledWith(expect.objectContaining({ tabId: 11 }));
  });
  it('unsplits the linked view only and verifies the result', async () => {
    const { api, tabs } = fixture();
    tabs[0]!.splitViewId = 5;
    tabs[1]!.splitViewId = 5;
    api.tabs.unsplit = vi.fn(async (splitId) => {
      tabs.forEach((tab) => {
        if (tab.splitViewId === splitId) tab.splitViewId = -1;
      });
    });
    await execute({ kind: 'unsplit' }, 10, api);
    expect(api.tabs.unsplit).toHaveBeenCalledWith(5);
    await expect(execute({ kind: 'unsplit' }, 10, api)).rejects.toThrow('not in an available');
  });
  it('reports partial window changes honestly if the OS rejects the requested bounds', async () => {
    const { api } = fixture();
    api.windows.update = vi.fn(async () => ({ id: 2 }));
    await expect(
      execute({ kind: 'arrange', layout: 'stacked' }, 10, api, { getWorkArea: () => area }),
    ).rejects.toThrow('may now be in separate windows');
  });
  it.each([
    'pin',
    'unpin',
    'mute',
    'unmute',
    'group',
    'ungroup',
    'reload',
    'back',
    'forward',
  ] as const)('executes %s on the linked tab', async (action) => {
    const { api } = fixture();
    expect(await execute({ kind: 'tab', action }, 10, api)).toBeTruthy();
    expect(api.tabs.get).toHaveBeenLastCalledWith(10);
  });
});
