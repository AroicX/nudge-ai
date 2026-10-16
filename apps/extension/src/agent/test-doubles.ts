import type {
  ContentRequest,
  ContentResult,
  ControllerMessage,
  PageElement,
  PageSnapshot,
  PlannerRequest,
  PlannerResponse,
  ScopeRequest,
  ScopeResponse,
  TabReference,
  ToolCall,
} from '@nudge/contracts';
import type { Checkpoint } from '@nudge/core';

import type { CheckpointPort, ContentPort, PlannerPort, ScreenshotPort, TabsPort } from './ports';

export interface FakePage {
  url: string;
  title: string;
  documentId: string;
  elements: PageElement[];
  text: string[];
  inaccessible?: PageSnapshot['inaccessible'];
  onExecute?: (call: Extract<ContentRequest, { type: 'execute' }>['call'], page: FakePage) => Partial<ContentResult> | void | Promise<Partial<ContentResult> | void>;
}

export function element(documentId: string, n: number, kind: PageElement['kind'], name: string, extra: Partial<PageElement> = {}): PageElement {
  return { id: `${documentId}:${n}`, kind, name, visible: true, disabled: false, ...extra };
}

export class FakeBrowser implements TabsPort, ContentPort {
  pages = new Map<number, FakePage>();
  sent: Array<{ tabId: number; request: ContentRequest }> = [];
  activated: number[] = [];
  closed: number[] = [];
  #removed = new Set<(id: number) => void>();
  #updated = new Set<(id: number, info: { url?: string | undefined; status?: string | undefined }) => void>();
  #nextTab = 100;
  executeGate?: Promise<void> | undefined;

  addTab(tabId: number, page: FakePage): this {
    this.pages.set(tabId, page);
    return this;
  }

  executes(): Array<{ tabId: number; call: ToolCall }> {
    return this.sent.flatMap((entry) => (entry.request.type === 'execute' ? [{ tabId: entry.tabId, call: entry.request.call as ToolCall }] : []));
  }

  #ref(tabId: number, page: FakePage, active = false): TabReference {
    return { tabId, windowId: 1, active, url: page.url, title: page.title, domain: new URL(page.url).hostname, discarded: false, lastSeenAt: '2026-10-15T18:00:00.000Z' };
  }

  async list() {
    return [...this.pages].map(([id, page]) => this.#ref(id, page));
  }
  async activate(tabId: number) {
    const page = this.pages.get(tabId);
    if (!page) throw new Error('That browser tab is not available.');
    this.activated.push(tabId);
    return this.#ref(tabId, page, true);
  }
  async open(url: string) {
    const tabId = this.#nextTab++;
    const page: FakePage = { url, title: 'Opened', documentId: `doc_${tabId}`, elements: [], text: [] };
    this.pages.set(tabId, page);
    return this.#ref(tabId, page, true);
  }
  async navigate(tabId: number, url: string) {
    const page = this.pages.get(tabId)!;
    page.url = url;
    page.documentId = `${page.documentId}n`;
  }
  async goBack() {}
  async goForward() {}
  async reload() {}
  async close(tabId: number) {
    this.closed.push(tabId);
    this.removeTab(tabId);
  }
  async waitForComplete(_tabId?: number, _timeoutMs?: number) {}
  onRemoved(listener: (id: number) => void) {
    this.#removed.add(listener);
    return () => this.#removed.delete(listener);
  }
  onUpdated(listener: (id: number, info: { url?: string | undefined; status?: string | undefined }) => void) {
    this.#updated.add(listener);
    return () => this.#updated.delete(listener);
  }
  removeTab(tabId: number) {
    this.pages.delete(tabId);
    this.#removed.forEach((listener) => listener(tabId));
  }
  navigateExternally(tabId: number, url: string) {
    const page = this.pages.get(tabId)!;
    page.url = url;
    this.#updated.forEach((listener) => listener(tabId, { url }));
  }

  snapshot(tabId: number): PageSnapshot {
    const page = this.pages.get(tabId)!;
    return {
      snapshotId: `snap_${Math.random()}`,
      documentId: page.documentId,
      capturedAt: '2026-10-15T18:00:00.000Z',
      url: page.url,
      title: page.title,
      viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0, pageHeight: 2000 },
      elements: page.elements,
      text: page.text,
      truncated: false,
      inaccessible: page.inaccessible ?? [],
      mutationCounter: 0,
    };
  }

  async send(tabId: number, request: ContentRequest): Promise<ContentResult> {
    this.sent.push({ tabId, request });
    const page = this.pages.get(tabId);
    if (!page) throw new Error('No tab with id');
    const base = { ok: true, detail: 'ok', changed: false, documentId: page.documentId };
    if (request.type === 'observe') return { ...base, snapshot: this.snapshot(tabId) };
    if (request.type === 'execute') {
      if (this.executeGate) await this.executeGate;
      if (request.documentId !== page.documentId) return { ...base, ok: false, detail: 'Page document is stale; observe again.' };
      const extra = (await page.onExecute?.(request.call, page)) ?? {};
      return { ...base, changed: true, ...extra };
    }
    return base;
  }
}

type PlanFn = (request: PlannerRequest) => Partial<PlannerResponse> & { toolCall: ToolCall };

export class FakePlanner implements PlannerPort {
  requests: PlannerRequest[] = [];
  scopes: ScopeRequest[] = [];
  gate?: Promise<void> | undefined;
  #steps: Array<PlanFn | (Partial<PlannerResponse> & { toolCall: ToolCall })>;

  constructor(
    steps: Array<PlanFn | (Partial<PlannerResponse> & { toolCall: ToolCall })>,
    public scopeProposal: Partial<ScopeResponse['proposal']> & { recordFields?: string[] } = {},
  ) {
    this.#steps = [...steps];
  }

  push(...steps: Array<PlanFn | (Partial<PlannerResponse> & { toolCall: ToolCall })>) {
    this.#steps.push(...steps);
  }

  async scope(request: ScopeRequest): Promise<ScopeResponse> {
    this.scopes.push(request);
    const { recordFields, ...proposal } = this.scopeProposal;
    return {
      requestId: request.requestId,
      goal: request.instruction,
      proposal: { origins: 'browse_web', categories: ['read', 'navigate'], destinations: [], exclusions: [], limits: {}, ...proposal },
      ...(recordFields ? { recordFields } : {}),
    };
  }

  async plan(request: PlannerRequest): Promise<PlannerResponse> {
    this.requests.push(request);
    if (this.gate) await this.gate;
    const next = this.#steps.shift();
    if (!next) return { requestId: request.requestId, toolCall: { tool: 'report_partial', done: [], remaining: ['nothing scripted'], reason: 'Test script ended.' } };
    const value = typeof next === 'function' ? next(request) : next;
    return { requestId: request.requestId, ...value };
  }
}

export class MemoryCheckpoints implements CheckpointPort {
  value: Checkpoint | undefined;
  saves: Checkpoint[] = [];
  async save(checkpoint: Checkpoint) {
    this.value = structuredClone(checkpoint);
    this.saves.push(this.value);
  }
  async load() {
    return this.value;
  }
  async clear() {
    this.value = undefined;
  }
}

export const noScreenshots: ScreenshotPort = {
  async capture() {
    throw new Error('screenshots disabled in this test');
  },
};

export function collector() {
  const messages: ControllerMessage[] = [];
  return {
    messages,
    emit: (message: ControllerMessage) => messages.push(message),
    states: () => messages.flatMap((message) => (message.type === 'state' ? [message.task] : [])),
    last: () => messages.flatMap((message) => (message.type === 'state' ? [message.task] : [])).at(-1),
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
