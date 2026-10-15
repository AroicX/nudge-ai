import { TabReferenceSchema, type SourceReference, type TabReference } from '@nudge/contracts';

interface BrowserTab {
  id?: number | undefined;
  windowId?: number | undefined;
  active?: boolean | undefined;
  url?: string | undefined;
  title?: string | undefined;
  favIconUrl?: string | undefined;
  discarded?: boolean | undefined;
  incognito?: boolean | undefined;
}

interface TabsApi {
  query(queryInfo: Record<string, unknown>): Promise<BrowserTab[]>;
  update(tabId: number, updateProperties: { active: boolean }): Promise<BrowserTab | undefined>;
  create(createProperties: { url: string }): Promise<BrowserTab>;
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
    removeListener(listener: (tabId: number) => void): void;
  };
}

function safeHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A valid HTTP(S) URL is required.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) URLs can be opened.');
  }
  return url;
}

export class TabRegistry {
  private readonly known = new Map<number, TabReference>();
  private readonly removed = new Set<number>();
  private readonly removedListener = (tabId: number) => {
    this.known.delete(tabId);
    this.removed.add(tabId);
  };

  constructor(
    private readonly tabs: TabsApi = browser.tabs,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.tabs.onRemoved.addListener(this.removedListener);
  }

  dispose() {
    this.tabs.onRemoved.removeListener(this.removedListener);
    this.known.clear();
    this.removed.clear();
  }

  private map(tab: BrowserTab): TabReference | undefined {
    if (tab.incognito || tab.id === undefined || tab.windowId === undefined || !tab.url) {
      return undefined;
    }
    let parsed: URL;
    try {
      parsed = safeHttpUrl(tab.url);
    } catch {
      return undefined;
    }
    return TabReferenceSchema.parse({
      tabId: tab.id,
      windowId: tab.windowId,
      active: tab.active ?? false,
      url: parsed.href,
      title: tab.title ?? parsed.hostname,
      domain: parsed.hostname,
      ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      discarded: tab.discarded ?? false,
      lastSeenAt: this.now(),
    });
  }

  async list(): Promise<TabReference[]> {
    const references = (await this.tabs.query({})).flatMap((tab) => {
      const reference = this.map(tab);
      return reference ? [reference] : [];
    });
    this.known.clear();
    references.forEach((reference) => this.known.set(reference.tabId, reference));
    references.forEach((reference) => this.removed.delete(reference.tabId));
    return references;
  }

  async activate(tabId: number): Promise<TabReference> {
    if (this.removed.has(tabId)) throw new Error('That browser tab is closed.');
    const reference = this.known.get(tabId) ?? (await this.list()).find((tab) => tab.tabId === tabId);
    if (!reference) throw new Error('That browser tab is closed.');
    if (reference.discarded) throw new Error('That browser tab was discarded by Chrome.');
    const updated = await this.tabs.update(tabId, { active: true });
    const mapped = updated && this.map({ ...updated, active: true });
    if (!mapped) throw new Error('That browser tab is closed.');
    this.known.set(tabId, mapped);
    return mapped;
  }

  async open(url: string): Promise<TabReference> {
    const safeUrl = safeHttpUrl(url).href;
    const reference = this.map(await this.tabs.create({ url: safeUrl }));
    if (!reference) throw new Error('Chrome did not return a usable tab.');
    this.known.set(reference.tabId, reference);
    return reference;
  }

  async resolveSource(
    source: SourceReference,
  ): Promise<{ kind: 'existing' | 'open'; tab?: TabReference; url: string }> {
    const url = safeHttpUrl(source.url).href;
    const current = (await this.list()).find(
      (tab) => tab.tabId === source.tabId && tab.url === url && !tab.discarded,
    );
    return current ? { kind: 'existing', tab: current, url } : { kind: 'open', url };
  }
}
