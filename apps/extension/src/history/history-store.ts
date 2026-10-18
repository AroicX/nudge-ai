import {
  PersistedConversationSchema,
  SourceReferenceSchema,
  type PersistedConversation,
  type PersistedTurn,
  type SourceReference,
  type TimelineStep,
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

function sanitizeSteps(steps: TimelineStep[]): TimelineStep[] {
  return steps.slice(-100).map((step) => ({
    id: step.id,
    label: redactText(step.label),
    status: step.status,
    ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
    ...(step.completedAt !== undefined ? { completedAt: step.completedAt } : {}),
    ...(step.detail ? { detail: redactText(step.detail) } : {}),
    ...(step.sources
      ? {
          sources: step.sources.flatMap((source) => {
            const safe = sanitizeSource(source);
            return safe ? [safe] : [];
          }),
        }
      : {}),
  }));
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
    ...(turn.progress
      ? {
          progress: {
            taskId: turn.progress.taskId,
            status: turn.progress.status,
            ...(turn.progress.startedAt !== undefined
              ? { startedAt: turn.progress.startedAt }
              : {}),
            ...(turn.progress.completedAt !== undefined
              ? { completedAt: turn.progress.completedAt }
              : {}),
            steps: sanitizeSteps(turn.progress.steps),
          },
        }
      : {}),
    ...(turn.provider ? { provider: turn.provider } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    sources: [...sources.values()],
  };
}

function bounded(value: PersistedConversation): PersistedConversation {
  const clean: PersistedConversation = {
    version: 1,
    turns: value.turns.slice(-200).map(sanitizeTurn),
    timeline: sanitizeSteps(value.timeline),
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
      const value =
        stored && typeof stored === 'object'
          ? Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'clearGeneration'))
          : stored;
      const parsed = PersistedConversationSchema.safeParse(value);
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

/** Every extension page shares this lock; merge only this client's edits, never its stale snapshot. */
export function createSharedHistoryStore(
  storage: StorageArea,
  lock: <T>(work: () => Promise<T>) => Promise<T>,
  storageKey = STORAGE_KEY,
) {
  let revision = 0;
  let baseline = structuredClone(EMPTY);
  let generation: string | undefined;
  const read = async () => {
    const raw = (await storage.get(storageKey))[storageKey];
    const historyValue =
      raw && typeof raw === 'object'
        ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'clearGeneration'))
        : raw;
    const parsed = PersistedConversationSchema.safeParse(historyValue);
    const epoch =
      raw &&
      typeof raw === 'object' &&
      'clearGeneration' in raw &&
      typeof raw.clearGeneration === 'string'
        ? raw.clearGeneration
        : 'initial';
    return { history: parsed.success ? parsed.data : structuredClone(EMPTY), epoch };
  };
  const write = async (history: PersistedConversation, epoch: string) => {
    const clean = bounded(history);
    try {
      await storage.set({ [storageKey]: { ...clean, clearGeneration: epoch } });
    } catch {
      const pruned = {
        ...clean,
        turns: clean.turns.slice(Math.max(1, Math.ceil(clean.turns.length / 4))),
      };
      await storage.set({ [storageKey]: { ...pruned, clearGeneration: epoch } });
    }
  };
  return {
    getRevision: () => revision,
    async loadHistory() {
      const requestedRevision = revision;
      return lock(async () => {
        const current = await read();
        if (requestedRevision === revision) {
          baseline = current.history;
          generation = current.epoch;
        }
        return current.history;
      });
    },
    async loadHistoryForUpdate() {
      const requestedRevision = revision;
      const history = await this.loadHistory();
      // A storage read can finish after a new local turn/progress update. Applying
      // that older snapshot would briefly remove the turn before task binding.
      return requestedRevision === revision ? history : undefined;
    },
    saveHistory(value: PersistedConversation) {
      revision++;
      const previous = baseline;
      const expectedGeneration = generation;
      const clean = bounded(value);
      // Capture deltas synchronously so a later storage notification cannot change this write.
      const changed = clean.turns.filter(
        (turn) =>
          JSON.stringify(turn) !== JSON.stringify(previous.turns.find((old) => old.id === turn.id)),
      );
      const timelineChanged = JSON.stringify(clean.timeline) !== JSON.stringify(previous.timeline);
      baseline = clean;
      return lock(async () => {
        const current = await read();
        if (expectedGeneration !== undefined && expectedGeneration !== current.epoch) return;
        const turns = [...current.history.turns];
        for (const turn of changed) {
          const index = turns.findIndex((old) => old.id === turn.id);
          if (index < 0) turns.push(turn);
          else {
            const old = previous.turns.find((item) => item.id === turn.id);
            // A source-only update must not replace progress written by another page.
            const patch = Object.fromEntries(
              Object.entries(turn).filter(
                ([key, value]) =>
                  JSON.stringify(value) !== JSON.stringify(old?.[key as keyof PersistedTurn]),
              ),
            );
            turns[index] = { ...turns[index]!, ...patch };
          }
        }
        await write(
          {
            version: 1,
            turns,
            timeline: timelineChanged ? clean.timeline : current.history.timeline,
          },
          current.epoch,
        );
        generation ??= current.epoch;
      });
    },
    async replaceHistory(history: PersistedConversation) {
      revision++;
      await lock(async () => {
        const epoch = crypto.randomUUID();
        await write(history, epoch);
        baseline = history;
        generation = epoch;
      });
    },
    async clearHistory() {
      revision++;
      await lock(async () => {
        const epoch = crypto.randomUUID();
        await write(structuredClone(EMPTY), epoch);
        baseline = structuredClone(EMPTY);
        generation = epoch;
      });
    },
  };
}

let activeStorageKey = STORAGE_KEY;
const stores = new Map<string, ReturnType<typeof createSharedHistoryStore>>();
const sharedStore = (key = activeStorageKey) => {
  let store = stores.get(key);
  if (!store) {
    store = createSharedHistoryStore(
      browser.storage.local,
      async (work) => await navigator.locks.request('nudge-conversation-history', work),
      key,
    );
    stores.set(key, store);
  }
  return store;
};
export const historyStore = {
  chat: (id: string) => sharedStore(`nudgeChatCache:${id}`),
  useChat(id: string) {
    activeStorageKey = `nudgeChatCache:${id}`;
  },
  loadLegacy: () => createHistoryStore(browser.storage.local).loadHistory(),
  replaceHistory: (value: PersistedConversation) => sharedStore().replaceHistory(value),
  loadHistory: () => sharedStore().loadHistory(),
  saveHistory: (value: PersistedConversation) => sharedStore().saveHistory(value),
  clearHistory: () => sharedStore().clearHistory(),
  subscribe(listener: (history: PersistedConversation) => void) {
    let active = true;
    const refresh = () => {
      const store = sharedStore();
      const revision = store.getRevision();
      void store
        .loadHistoryForUpdate()
        .then((history) => {
          if (active && history && revision === store.getRevision()) listener(history);
        })
        .catch(() => undefined);
    };
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && activeStorageKey in changes) refresh();
    };
    browser.storage.onChanged.addListener(changed);
    refresh();
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(changed);
    };
  },
};
