import type { PersistedConversation } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createHistoryStore, createSharedHistoryStore } from './history-store';

function memoryStorage(initial?: unknown) {
  let value = initial;
  return {
    get: vi.fn(async () => ({ nudgeConversationV1: value })),
    set: vi.fn(async (next: Record<string, unknown>) => {
      value = next.nudgeConversationV1;
    }),
    remove: vi.fn(async () => {
      value = undefined;
    }),
    value: () => value,
  };
}

const source = {
  tabId: 2,
  windowId: 1,
  active: false,
  url: 'https://mail.google.com/mail/u/0/#inbox',
  title: 'Netflix payment reminder',
  domain: 'mail.google.com',
  discarded: false,
  lastSeenAt: '2026-10-15T20:00:00.000Z',
};

const conversation: PersistedConversation = {
  version: 1,
  turns: [
    {
      id: 'turn-1',
      role: 'assistant',
      text: 'I found the message.',
      createdAt: '2026-10-15T20:00:00.000Z',
      sources: [source],
    },
  ],
  timeline: [],
};

describe('history store', () => {
  it('restores serialized turns and their source links after restart', async () => {
    const storage = memoryStorage();
    await createHistoryStore(storage).saveHistory(conversation);
    await expect(createHistoryStore(storage).loadHistory()).resolves.toEqual(conversation);
  });

  it('drops unsafe sources and truncates oversized source labels before saving', async () => {
    const storage = memoryStorage();
    await createHistoryStore(storage).saveHistory({
      ...conversation,
      turns: [
        {
          ...conversation.turns[0]!,
          sources: [
            { ...source, url: 'javascript:alert(1)' },
            { ...source, title: 'x'.repeat(700), url: `https://example.com/${'y'.repeat(2200)}` },
          ],
        },
      ],
    } as PersistedConversation);
    const saved = (storage.value() as PersistedConversation).turns[0]!.sources;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.title).toHaveLength(500);
    expect(saved[0]!.url.length).toBeLessThanOrEqual(2_000);
  });

  it('bounds history to 200 turns and retries once with older turns pruned on quota errors', async () => {
    const storage = memoryStorage();
    storage.set.mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));
    const turns = Array.from({ length: 240 }, (_, index) => ({
      id: `turn-${index}`,
      role: 'user' as const,
      text: `message ${index}`,
      createdAt: '2026-10-15T20:00:00.000Z',
      sources: [],
    }));
    await createHistoryStore(storage).saveHistory({ version: 1, turns, timeline: [] });
    expect(storage.set).toHaveBeenCalledTimes(2);
    const saved = storage.value() as PersistedConversation;
    expect(saved.turns.length).toBeLessThan(200);
    expect(saved.turns.at(-1)?.id).toBe('turn-239');
  });

  it('clears saved history and never serializes forbidden credential-shaped fields', async () => {
    const storage = memoryStorage();
    await createHistoryStore(storage).saveHistory({
      ...conversation,
      apiKey: 'sk-secret',
      password: 'hunter2',
      otp: '123456',
      rawSnapshot: '<input value="secret">',
    } as PersistedConversation);
    const serialized = JSON.stringify(storage.value());
    expect(serialized).not.toMatch(/apiKey|password|otp|rawSnapshot|sk-secret|hunter2|123456/);
    await createHistoryStore(storage).clearHistory();
    expect(storage.remove).toHaveBeenCalledWith('nudgeConversationV1');
  });

  it('keeps an attached image on the saved chat turn', async () => {
    const storage = memoryStorage();
    const thumbnail = 'data:image/jpeg;base64,AAAA';
    await createHistoryStore(storage).saveHistory({
      version: 1,
      turns: [
        {
          id: 'turn-photo',
          role: 'user',
          text: 'What is this?',
          createdAt: '2026-10-18T20:00:00.000Z',
          images: [{ name: 'shot.jpg', mime: 'image/jpeg', width: 32, height: 32, thumbnail }],
          sources: [],
        },
      ],
      timeline: [],
    });
    expect((storage.value() as PersistedConversation).turns[0]?.images?.[0]?.thumbnail).toBe(thumbnail);
  });

  it('collapses duplicate sources by normalized URL', async () => {
    const storage = memoryStorage();
    await createHistoryStore(storage).saveHistory({
      ...conversation,
      turns: [{ ...conversation.turns[0]!, sources: [source, { ...source, tabId: 9 }] }],
    });
    expect((storage.value() as PersistedConversation).turns[0]!.sources).toHaveLength(1);
  });
});

describe('history redaction', () => {
  it('redacts code-like text in persisted turns and timeline', async () => {
    const storage = memoryStorage();
    await createHistoryStore(storage).saveHistory({
      version: 1,
      turns: [
        {
          id: 't1',
          role: 'assistant',
          text: 'Your Acme verification code is 482913',
          createdAt: '2026-10-15T20:00:00.000Z',
          sources: [],
        },
      ],
      timeline: [{ id: 's1', label: 'Found verification code 482913', status: 'completed' }],
    });
    expect(JSON.stringify(storage.value())).not.toContain('482913');
  });
});

it('preserves measured step durations after saving and reloading history', async () => {
  const storage = memoryStorage();
  const timeline = [
    {
      id: 'task:scope',
      label: 'Understood the request',
      status: 'completed' as const,
      startedAt: 1000,
      completedAt: 3750,
    },
  ];
  await createHistoryStore(storage).saveHistory({ ...conversation, timeline });
  expect((await createHistoryStore(storage).loadHistory()).timeline).toEqual(timeline);
});

it('retains completed per-request progress and durations through reload', async () => {
  const storage = memoryStorage();
  const progress = {
    taskId: 'task-1',
    status: 'completed' as const,
    startedAt: 1000,
    completedAt: 6000,
    steps: [
      {
        id: 's1',
        label: 'Read page',
        status: 'completed' as const,
        startedAt: 2000,
        completedAt: 5000,
      },
    ],
  };
  await createHistoryStore(storage).saveHistory({
    ...conversation,
    turns: [{ ...conversation.turns[0]!, role: 'user', progress }],
  });
  expect((await createHistoryStore(storage).loadHistory()).turns[0]?.progress).toEqual(progress);
});

it('sanitizes and bounds progress saved on individual requests', async () => {
  const storage = memoryStorage();
  await createHistoryStore(storage).saveHistory({
    ...conversation,
    turns: [
      {
        ...conversation.turns[0]!,
        progress: {
          taskId: 'task-safe',
          status: 'completed',
          steps: Array.from({ length: 105 }, (_, i) => ({
            id: `s-${i}`,
            label: 'Found verification code 482913',
            status: 'completed' as const,
            sources: [{ ...source, url: 'javascript:alert(1)' }],
          })),
        },
      },
    ],
  });
  const saved = (await createHistoryStore(storage).loadHistory()).turns[0]!.progress!;
  expect(saved.steps).toHaveLength(100);
  expect(saved.steps[0]?.sources).toEqual([]);
  expect(JSON.stringify(saved)).not.toContain('482913');
});

describe('simultaneous extension pages', () => {
  function pages() {
    const storage = memoryStorage();
    let tail: Promise<unknown> = Promise.resolve();
    const lock = <T>(work: () => Promise<T>): Promise<T> => {
      const result = tail.then(work);
      tail = result.catch(() => undefined);
      return result;
    };
    return {
      a: createSharedHistoryStore(storage, lock),
      b: createSharedHistoryStore(storage, lock),
    };
  }
  it('merges simultaneous new turns rather than overwriting the other page', async () => {
    const { a, b } = pages();
    await Promise.all([a.loadHistory(), b.loadHistory()]);
    await Promise.all([
      a.saveHistory(conversation),
      b.saveHistory({ ...conversation, turns: [{ ...conversation.turns[0]!, id: 'turn-2' }] }),
    ]);
    expect((await a.loadHistory()).turns.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2']);
  });
  it('does not resurrect history from a stale page after clearing', async () => {
    const { a, b } = pages();
    await a.saveHistory(conversation);
    const stale = await b.loadHistory();
    await a.clearHistory();
    await b.saveHistory({
      ...stale,
      timeline: [{ id: 'late', label: 'Late update', status: 'active' }],
    });
    expect((await a.loadHistory()).turns).toEqual([]);
    expect((await a.loadHistory()).timeline).toEqual([]);
    await b.loadHistory();
    await b.saveHistory({ ...conversation, turns: [{ ...conversation.turns[0]!, id: 'new' }] });
    expect((await a.loadHistory()).turns.map((turn) => turn.id)).toEqual(['new']);
  });
  it('merges a source update without reverting progress from another page', async () => {
    const { a, b } = pages();
    await a.saveHistory(conversation);
    await Promise.all([a.loadHistory(), b.loadHistory()]);
    const progress = { taskId: 'task-1', status: 'completed' as const, steps: [] };
    await a.saveHistory({ ...conversation, turns: [{ ...conversation.turns[0]!, progress }] });
    await b.saveHistory({ ...conversation, turns: [{ ...conversation.turns[0]!, sources: [] }] });
    expect((await a.loadHistory()).turns[0]).toMatchObject({ progress, sources: [] });
  });
});

it('discards a shared-history refresh that overlaps a new local request', async () => {
  const storage = memoryStorage(conversation);
  let queue = Promise.resolve();
  const lock = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const store = createSharedHistoryStore(storage, lock);
  await store.loadHistory();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  storage.get.mockImplementationOnce(async () => {
    const snapshot = storage.value();
    await held;
    return { nudgeConversationV1: snapshot };
  });
  const refresh = store.loadHistoryForUpdate();
  await Promise.resolve();
  const next = {
    ...conversation,
    turns: [
      ...conversation.turns,
      {
        id: 'next-request',
        role: 'user' as const,
        text: 'Reset zoom',
        createdAt: source.lastSeenAt,
        sources: [],
      },
    ],
  };
  const saved = store.saveHistory(next);
  release();
  expect(await refresh).toBeUndefined();
  await saved;
  expect((await store.loadHistoryForUpdate())?.turns.at(-1)?.id).toBe('next-request');
});
