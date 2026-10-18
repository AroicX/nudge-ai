import { describe, expect, it, vi } from 'vitest';
import type { TabReference } from '@nudge/contracts';
import { fullPageUrl, readPageMode, resolvePageSource } from './page-mode';

const tab = (tabId: number, url: string): TabReference => ({
  tabId,
  windowId: 1,
  url,
  title: url,
  domain: new URL(url).hostname,
  active: false,
  discarded: false,
  lastSeenAt: '2026-10-18T00:00:00Z',
});
describe('full-page chat source', () => {
  it('opens the extension page with the explicit original tab', () => {
    const url = fullPageUrl('chrome-extension://nudge/sidepanel.html', 42);
    expect(url).toBe('chrome-extension://nudge/sidepanel.html?view=fullpage&sourceTabId=42');
    expect(readPageMode(new URL(url).search)).toEqual({ fullPage: true, sourceTabId: 42 });
    expect(readPageMode('?view=fullpage&sourceTabId=-1').sourceTabId).toBeUndefined();
  });
  it('reads the originating tab live as it navigates, even when another tab is active', async () => {
    const registry = {
      current: vi.fn().mockResolvedValue(tab(7, 'https://wrong.test')),
      list: vi.fn().mockResolvedValue([tab(42, 'https://source.test/first')]),
    };
    expect((await resolvePageSource(registry, true, 42))?.url).toBe('https://source.test/first');
    registry.list.mockResolvedValue([tab(42, 'https://source.test/second')]);
    expect((await resolvePageSource(registry, true, 42))?.url).toBe('https://source.test/second');
    expect(registry.current).not.toHaveBeenCalled();
  });
  it('never substitutes an unrelated tab when the original closes or no source is attached', async () => {
    const registry = {
      current: vi.fn().mockResolvedValue(tab(7, 'https://wrong.test')),
      list: vi.fn().mockResolvedValue([tab(7, 'https://wrong.test')]),
    };
    expect(await resolvePageSource(registry, true, 42)).toBeUndefined();
    expect(await resolvePageSource(registry, true)).toBeUndefined();
    expect(registry.current).not.toHaveBeenCalled();
    expect((await resolvePageSource(registry, false))?.tabId).toBe(7);
  });
});
