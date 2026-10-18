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
  status?: string | undefined;
}

type UpdatedListener = (
  tabId: number,
  info: { url?: string | undefined; status?: string | undefined },
) => void;

interface TabsApi {
  query(queryInfo: Record<string, unknown>): Promise<BrowserTab[]>;
  update(
    tabId: number,
    updateProperties: { active?: boolean; url?: string },
  ): Promise<BrowserTab | undefined>;
  create(createProperties: { url: string; active?: boolean }): Promise<BrowserTab>;
  get?(tabId: number): Promise<BrowserTab | undefined>;
  remove?(tabId: number): Promise<void> | void;
  goBack?(tabId: number): Promise<void>;
  goForward?(tabId: number): Promise<void>;
  reload?(tabId: number): Promise<void>;
  onRemoved: {
    addListener(listener: (tabId: number) => void): void;
    removeListener(listener: (tabId: number) => void): void;
  };
  onUpdated?: {
    addListener(listener: UpdatedListener): void;
    removeListener(listener: UpdatedListener): void;
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

  /** Resolve the page beside this panel, without falling back to another window. */
  async current(): Promise<TabReference | undefined> {
    const [tab] = await this.tabs.query({ active: true, currentWindow: true });
    return tab ? this.map(tab) : undefined;
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
    const reference =
      this.known.get(tabId) ?? (await this.list()).find((tab) => tab.tabId === tabId);
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
    const created = await this.tabs.create({ url: safeUrl });
    let reference = this.map(created);
    for (let attempt = 0; !reference && created.id !== undefined && attempt < 10; attempt += 1) {
      const current = this.tabs.get
        ? await this.tabs.get(created.id).catch(() => undefined)
        : (await this.tabs.query({})).find((tab) => tab.id === created.id);
      reference = current ? this.map(current) : undefined;
      if (!reference) await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    if (!reference)
      throw new Error('Chrome opened the tab, but it did not become available to Nudge.');
    this.known.set(reference.tabId, reference);
    return reference;
  }

  async #requireKnown(tabId: number): Promise<TabReference> {
    if (this.removed.has(tabId)) throw new Error('That browser tab is not available.');
    const reference =
      this.known.get(tabId) ?? (await this.list()).find((tab) => tab.tabId === tabId);
    if (!reference) throw new Error('That browser tab is not available.');
    return reference;
  }

  async navigate(tabId: number, url: string): Promise<void> {
    const safeUrl = safeHttpUrl(url).href;
    await this.#requireKnown(tabId);
    await this.tabs.update(tabId, { url: safeUrl });
    await this.waitForComplete(tabId, 15_000);
  }

  async goBack(tabId: number): Promise<void> {
    await this.#requireKnown(tabId);
    await this.tabs.goBack?.(tabId);
    await this.waitForComplete(tabId, 15_000);
  }

  async goForward(tabId: number): Promise<void> {
    await this.#requireKnown(tabId);
    await this.tabs.goForward?.(tabId);
    await this.waitForComplete(tabId, 15_000);
  }

  async reload(tabId: number): Promise<void> {
    await this.#requireKnown(tabId);
    await this.tabs.reload?.(tabId);
    await this.waitForComplete(tabId, 15_000);
  }

  async close(tabId: number): Promise<void> {
    await this.#requireKnown(tabId);
    if (!this.tabs.remove) throw new Error('Closing tabs is not supported here.');
    await this.tabs.remove(tabId);
    this.removedListener(tabId);
  }

  /** Resolve once the tab reports status "complete" (or the timeout passes). */
  waitForComplete(tabId: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.tabs.onUpdated?.removeListener(listener);
        resolve();
      };
      const listener: UpdatedListener = (id, info) => {
        if (id === tabId && info.status === 'complete') done();
      };
      const timer = setTimeout(done, timeoutMs);
      this.tabs.onUpdated?.addListener(listener);
      // Small grace period so a navigation that has not started yet is not mistaken for complete.
      setTimeout(() => {
        void this.tabs.get?.(tabId).then((tab) => {
          if (!tab || tab.status === 'complete') done();
        }, done);
      }, 50);
    });
  }

  onRemoved(listener: (tabId: number) => void): () => void {
    this.tabs.onRemoved.addListener(listener);
    return () => this.tabs.onRemoved.removeListener(listener);
  }

  onUpdated(listener: UpdatedListener): () => void {
    this.tabs.onUpdated?.addListener(listener);
    return () => this.tabs.onUpdated?.removeListener(listener);
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
