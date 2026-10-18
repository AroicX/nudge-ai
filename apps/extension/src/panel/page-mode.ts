import type { TabReference } from '@nudge/contracts';

export function readPageMode(search: string) {
  const params = new URLSearchParams(search);
  const raw = params.get('sourceTabId');
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
  return {
    fullPage: params.get('view') === 'fullpage',
    sourceTabId:
      parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined,
  };
}

export function fullPageUrl(extensionUrl: string, sourceTabId?: number) {
  const url = new URL(extensionUrl);
  url.searchParams.set('view', 'fullpage');
  if (sourceTabId !== undefined) url.searchParams.set('sourceTabId', String(sourceTabId));
  return url.href;
}

/** Read the linked tab afresh: its URL may change while the chat stays open. */
export async function resolvePageSource(
  registry: { current(): Promise<TabReference | undefined>; list(): Promise<TabReference[]> },
  fullPage: boolean,
  sourceTabId?: number,
): Promise<TabReference | undefined> {
  if (!fullPage) return registry.current();
  if (sourceTabId === undefined) return undefined;
  return (await registry.list()).find((tab) => tab.tabId === sourceTabId && !tab.discarded);
}
