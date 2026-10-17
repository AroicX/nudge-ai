import type { SourceReference } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { TabRegistry } from './tab-registry';

const now = () => '2026-10-15T20:00:00.000Z';

function api(tabs: Array<Record<string, unknown>>) {
  const removed = new Set<(tabId: number) => void>();
  return {
    query: vi.fn().mockResolvedValue(tabs),
    update: vi.fn(async (tabId: number) => tabs.find((tab) => tab.id === tabId)),
    create: vi.fn(async ({ url }: { url: string }) => ({
      id: 50,
      windowId: 4,
      active: true,
      url,
      title: 'Opened',
      discarded: false,
    })),
    onRemoved: {
      addListener: (listener: (tabId: number) => void) => removed.add(listener),
      removeListener: (listener: (tabId: number) => void) => removed.delete(listener),
    },
    remove(tabId: number) {
      removed.forEach((listener) => listener(tabId));
    },
  };
}

describe('TabRegistry', () => {
  it('lists only non-incognito HTTP tabs and maps safe metadata', async () => {
    const tabs = api([
      {
        id: 1,
        windowId: 3,
        active: true,
        url: 'https://mail.google.com/mail/u/0/',
        title: 'Inbox',
        favIconUrl: 'https://mail.google.com/favicon.ico',
        discarded: false,
      },
      { id: 2, windowId: 3, url: 'chrome://settings', title: 'Settings' },
      { id: 3, windowId: 3, url: 'https://secret.test', title: 'Private', incognito: true },
    ]);
    const registry = new TabRegistry(tabs, now);

    await expect(registry.list()).resolves.toEqual([
      expect.objectContaining({
        tabId: 1,
        windowId: 3,
        active: true,
        title: 'Inbox',
        domain: 'mail.google.com',
        favIconUrl: 'https://mail.google.com/favicon.ico',
        discarded: false,
        lastSeenAt: now(),
      }),
    ]);
  });

  it('activates in the current window and rejects closed or discarded tabs', async () => {
    const tabs = api([
      { id: 1, windowId: 3, active: false, url: 'https://example.com', title: 'Example' },
      {
        id: 2,
        windowId: 3,
        active: false,
        discarded: true,
        url: 'https://sleep.test',
        title: 'Sleeping',
      },
    ]);
    const registry = new TabRegistry(tabs, now);
    await registry.list();

    await expect(registry.activate(1)).resolves.toMatchObject({ tabId: 1 });
    expect(tabs.update).toHaveBeenCalledWith(1, { active: true });
    await expect(registry.activate(2)).rejects.toThrow('discarded');
    tabs.remove(1);
    await expect(registry.activate(1)).rejects.toThrow('closed');
  });

  it('does not trust a reused tab ID whose URL changed', async () => {
    const tabs = api([{ id: 8, windowId: 1, active: true, url: 'https://old.test', title: 'Old' }]);
    const registry = new TabRegistry(tabs, now);
    const [source] = await registry.list();
    tabs.query.mockResolvedValueOnce([
      { id: 8, windowId: 1, active: true, url: 'https://new.test', title: 'New' },
    ]);

    const resolved = await registry.resolveSource(source as SourceReference);
    expect(resolved.kind).toBe('open');
    expect(resolved.url).toBe('https://old.test/');
  });

  it('opens safe sources and rejects non-HTTP URLs before calling Chrome', async () => {
    const tabs = api([]);
    const registry = new TabRegistry(tabs, now);
    await expect(registry.open('https://example.com/path')).resolves.toMatchObject({
      tabId: 50,
      url: 'https://example.com/path',
    });
    await expect(registry.open('chrome://settings')).rejects.toThrow('HTTP');
    expect(tabs.create).toHaveBeenCalledTimes(1);
  });

  it('waits for Chrome to populate a newly-created tab URL', async () => {
    const tabs = api([]);
    tabs.create.mockResolvedValueOnce({ id: 51, windowId: 4, active: true } as never);
    tabs.query.mockResolvedValueOnce([
      { id: 51, windowId: 4, active: true, url: 'https://github.com/', title: 'GitHub' },
    ]);
    const registry = new TabRegistry(tabs, now);

    await expect(registry.open('https://github.com')).resolves.toMatchObject({
      tabId: 51,
      url: 'https://github.com/',
    });
  });
});
