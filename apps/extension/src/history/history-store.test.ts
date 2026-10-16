import type { PersistedConversation } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createHistoryStore } from './history-store';

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
      turns: [{ id: 't1', role: 'assistant', text: 'Your Acme verification code is 482913', createdAt: '2026-10-15T20:00:00.000Z', sources: [] }],
      timeline: [{ id: 's1', label: 'Found verification code 482913', status: 'completed' }],
    });
    expect(JSON.stringify(storage.value())).not.toContain('482913');
  });
});
