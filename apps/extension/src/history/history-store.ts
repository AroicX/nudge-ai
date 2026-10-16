import {
  PersistedConversationSchema,
  SourceReferenceSchema,
  type PersistedConversation,
  type PersistedTurn,
  type SourceReference,
} from '@nudge/contracts';
import { redactText } from '@nudge/core';

const STORAGE_KEY = 'nudgeConversationV1';
const MAX_BYTES = 1024 * 1024;
const EMPTY: PersistedConversation = { version: 1, turns: [], timeline: [] };

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

function sanitizeSource(value: SourceReference): SourceReference | undefined {
  const candidate = {
    tabId: value.tabId,
    windowId: value.windowId,
    active: value.active,
    url: value.url.slice(0, 2_000),
    title: value.title.slice(0, 500),
    domain: value.domain.slice(0, 253),
    ...(value.favIconUrl ? { favIconUrl: value.favIconUrl.slice(0, 2_000) } : {}),
    discarded: value.discarded,
    lastSeenAt: value.lastSeenAt,
  };
  const parsed = SourceReferenceSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function sanitizeTurn(turn: PersistedTurn): PersistedTurn {
  const sources = new Map<string, SourceReference>();
  for (const source of turn.sources ?? []) {
    const safe = sanitizeSource(source);
    if (safe) sources.set(new URL(safe.url).href, safe);
  }
  return {
    id: turn.id,
    role: turn.role,
    text: redactText(turn.text),
    createdAt: turn.createdAt,
    ...(turn.provider ? { provider: turn.provider } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    sources: [...sources.values()],
  };
}

function bounded(value: PersistedConversation): PersistedConversation {
  const clean: PersistedConversation = {
    version: 1,
    turns: value.turns.slice(-200).map(sanitizeTurn),
    timeline: value.timeline.slice(-100).map((step) => ({
      id: step.id,
      label: redactText(step.label),
      status: step.status,
      ...(step.detail ? { detail: redactText(step.detail) } : {}),
      ...(step.sources
        ? {
            sources: step.sources.flatMap((source) => {
              const safe = sanitizeSource(source);
              return safe ? [safe] : [];
            }),
          }
        : {}),
    })),
  };
  while (clean.turns.length && new TextEncoder().encode(JSON.stringify(clean)).length > MAX_BYTES) {
    clean.turns.shift();
  }
  return PersistedConversationSchema.parse(clean);
}

export function createHistoryStore(storage: StorageArea) {
  return {
    async loadHistory(): Promise<PersistedConversation> {
      const stored = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
      const parsed = PersistedConversationSchema.safeParse(stored);
      return parsed.success ? parsed.data : structuredClone(EMPTY);
    },
    async saveHistory(value: PersistedConversation): Promise<void> {
      const clean = bounded(value);
      try {
        await storage.set({ [STORAGE_KEY]: clean });
      } catch {
        const pruneCount = Math.max(1, Math.ceil(clean.turns.length / 4));
        const pruned = { ...clean, turns: clean.turns.slice(pruneCount) };
        await storage.set({ [STORAGE_KEY]: pruned });
      }
    },
    async clearHistory(): Promise<void> {
      await storage.remove(STORAGE_KEY);
    },
  };
}

export const historyStore = {
  loadHistory: () => createHistoryStore(browser.storage.local).loadHistory(),
  saveHistory: (value: PersistedConversation) =>
    createHistoryStore(browser.storage.local).saveHistory(value),
  clearHistory: () => createHistoryStore(browser.storage.local).clearHistory(),
};
