// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedTurn } from '@nudge/contracts';
import type { MemoryClient } from '../api/memory-client';
import { useNudgeStore } from '../state/use-nudge-store';
import { useMemoryWorkspace } from './use-memory-workspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('SQLite workspace and browser cache', () => {
  const cleanupWorkspace = async () => {
    const values: Record<string, unknown> = {
      nudgeActiveChat: 'current',
      nudgeSqliteMigrated: true,
    };
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: async (keys: string | string[]) =>
            Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]]),
            ),
          set: async (updates: Record<string, unknown>) => Object.assign(values, updates),
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
          },
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          optionsOrWork: unknown,
          callback?: (lock: { name: string }) => Promise<unknown>,
        ) => (callback ? callback({ name }) : (optionsOrWork as () => Promise<unknown>)()),
      },
    });
    const chats = new Map(
      ['current', 'older'].map((id) => [
        id,
        {
          id,
          title: id,
          generation: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ]),
    );
    let facts = [
      {
        key: 'name',
        value: 'Alex',
        source: 'chat:older/message:old-message',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ];
    const client = {
      chats: vi.fn(async () => [...chats.values()].map((chat) => ({ ...chat }))),
      messages: vi.fn(async () => ({ messages: [], generation: 0 })),
      saveMessages: vi.fn(async (id: string) => {
        chats.get(id)!.updatedAt = '2026-10-18T00:00:00.000Z';
        return { messages: [], generation: 0 };
      }),
      facts: vi.fn(async () => [...facts]),
      documents: vi.fn(async () => []),
      deleteChat: vi.fn(async (id: string) => {
        chats.delete(id);
        if (id === 'older') facts = [];
      }),
    } as unknown as MemoryClient;
    const { result } = renderHook(() => useMemoryWorkspace(client));
    await waitFor(() => expect(result.current.activeId).toBe('current'));
    return { result, client, chats };
  };

  it('keeps a cleanup candidate whose server timestamp changed after the list was loaded', async () => {
    const { result, client, chats } = await cleanupWorkspace();
    expect(result.current.chats.find((chat) => chat.id === 'older')!.updatedAt).toBe(
      '2025-01-01T00:00:00.000Z',
    );
    // Another window has used this chat since the user reviewed cleanup candidates.
    chats.get('older')!.updatedAt = '2026-10-18T00:00:00.000Z';
    await act(async () => {
      expect(await result.current.deleteChat('older', Date.parse('2026-07-20T00:00:00.000Z'))).toBe(
        false,
      );
    });
    expect(client.deleteChat).not.toHaveBeenCalled();
    expect(result.current.error).toContain('used recently');
    expect(result.current.chats.find((chat) => chat.id === 'older')!.updatedAt).toBe(
      '2026-10-18T00:00:00.000Z',
    );
  });

  it('refreshes derived profile details after deleting an eligible old chat', async () => {
    const { result, client } = await cleanupWorkspace();
    await act(async () => {
      await result.current.refreshMemory();
    });
    expect(result.current.facts).toHaveLength(1);
    await act(async () => {
      expect(await result.current.deleteChat('older', Date.parse('2026-07-20T00:00:00.000Z'))).toBe(
        true,
      );
    });
    expect(client.deleteChat).toHaveBeenCalledWith('older');
    expect(result.current.facts).toEqual([]);
    expect(result.current.chats.map((chat) => chat.id)).toEqual(['current']);
    expect(result.current.activeId).toBe('current');
  });

  it('refreshes named chat timestamps after saving messages', async () => {
    const { result } = await cleanupWorkspace();
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.chats.find((chat) => chat.id === 'current')!.updatedAt).toBe(
      '2026-10-18T00:00:00.000Z',
    );
  });

  it.each([false, true])(
    'migrates preserved legacy turns into an empty database with migration flag %s, isolates caches and preserves offline history',
    async (alreadyMigrated) => {
      const original: PersistedTurn = {
        id: 'old-turn',
        role: 'user',
        text: 'Original chat',
        createdAt: '2026-10-18T00:00:00.000Z',
        sources: [],
      };
      const values: Record<string, unknown> = {
        nudgeSqliteMigrated: alreadyMigrated,
        nudgeConversationV1: { version: 1, turns: [original], timeline: [] },
        ...(alreadyMigrated
          ? {
              'nudgeChatCache:legacy-chat-v1': {
                version: 1,
                turns: [{ ...original, id: 'foreign-turn', text: 'Isolated database fixture' }],
                timeline: [],
              },
              'nudgeChatGeneration:legacy-chat-v1': 0,
            }
          : {}),
      };
      const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
      vi.stubGlobal('browser', {
        storage: {
          local: {
            get: async (keys: string | string[]) =>
              Object.fromEntries(
                (Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]]),
              ),
            set: async (updates: Record<string, unknown>) => {
              const changes: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(updates)) {
                if (JSON.stringify(values[key]) !== JSON.stringify(value))
                  changes[key] = { newValue: value };
                values[key] = value;
              }
              if (Object.keys(changes).length)
                for (const listener of listeners) listener(changes, 'local');
            },
            remove: async (key: string) => {
              delete values[key];
            },
          },
          onChanged: {
            addListener: (fn: typeof listeners extends Set<infer L> ? L : never) =>
              listeners.add(fn),
            removeListener: (fn: typeof listeners extends Set<infer L> ? L : never) =>
              listeners.delete(fn),
          },
        },
      });
      const locks = new Map<string, Promise<unknown>>();
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: (
            name: string,
            optionsOrWork: unknown,
            callback?: (lock: { name: string }) => Promise<unknown>,
          ) => {
            const work = callback
              ? () => callback({ name })
              : (optionsOrWork as () => Promise<unknown>);
            const result = (locks.get(name) ?? Promise.resolve()).catch(() => undefined).then(work);
            locks.set(name, result);
            return result;
          },
        },
      });
      const chats = new Map<
        string,
        { id: string; title: string; generation: number; createdAt: string; updatedAt: string }
      >();
      const messages = new Map<string, PersistedTurn[]>();
      const client = {
        chats: vi.fn(async () => [...chats.values()]),
        createChat: vi.fn(async (title = 'New chat', id = crypto.randomUUID()) => {
          const chat = { id, title, generation: 0, createdAt: 'today', updatedAt: 'today' };
          chats.set(id, chat);
          messages.set(id, []);
          return chat;
        }),
        messages: vi.fn(async (id: string) => ({
          messages: messages.get(id) ?? [],
          generation: chats.get(id)!.generation,
        })),
        saveMessages: vi.fn(async (id: string, turns: PersistedTurn[], generation: number) => {
          if (generation !== chats.get(id)!.generation) throw Error('Stale generation');
          const merged = new Map((messages.get(id) ?? []).map((turn) => [turn.id, turn]));
          for (const turn of turns) merged.set(turn.id, turn);
          messages.set(id, [...merged.values()]);
          return { messages: [...merged.values()], generation };
        }),
        renameChat: vi.fn(async (id: string, title: string) => {
          chats.get(id)!.title = title;
        }),
      } as unknown as MemoryClient;
      const { result } = renderHook(() => useMemoryWorkspace(client));
      await waitFor(() => expect(result.current.activeId).toBe('legacy-chat-v1'));
      expect(useNudgeStore.getState().conversation.map((turn) => turn.text)).toEqual([
        'Original chat',
      ]);
      expect(values.nudgeSqliteMigrated).toBe(true);
      expect(messages.get('legacy-chat-v1')).toEqual([original]);
      expect((values.nudgeConversationV1 as { turns: PersistedTurn[] }).turns).toEqual([original]);
      await act(async () => {
        await result.current.newChat();
      });
      const second = result.current.activeId!;
      expect(second).not.toBe('legacy-chat-v1');
      expect(useNudgeStore.getState().conversation).toHaveLength(0);
      await act(async () => {
        useNudgeStore.getState().addTurn({
          id: 'new-turn',
          role: 'user',
          text: 'Second chat only',
          createdAt: '2026-10-18T00:00:00.000Z',
        });
        await result.current.flush();
      });
      await act(async () => {
        await result.current.selectChat('legacy-chat-v1');
      });
      expect(useNudgeStore.getState().conversation.map((turn) => turn.text)).toEqual([
        'Original chat',
      ]);
      expect(messages.get(second)?.map((turn) => turn.text)).toEqual(['Second chat only']);
      vi.mocked(client.messages).mockRejectedValue(new Error('Backend offline'));
      await act(async () => {
        await result.current.selectChat(second);
      });
      expect(useNudgeStore.getState().conversation.map((turn) => turn.text)).toEqual([
        'Second chat only',
      ]);
      expect(result.current.error).toContain('browser cache');
      expect((values.nudgeConversationV1 as { turns: PersistedTurn[] }).turns).toEqual([original]);
      vi.mocked(client.messages).mockImplementation(async (id: string) => ({
        messages: messages.get(id) ?? [],
        generation: chats.get(id)!.generation,
      }));
      // A clear from another window must invalidate the old generation before any save.
      chats.get(second)!.generation = 1;
      messages.set(second, []);
      await act(async () => {
        await browser.storage.local.set({ [`nudgeChatGeneration:${second}`]: 1 });
      });
      await waitFor(() => expect(useNudgeStore.getState().conversation).toHaveLength(0));
      await act(async () => {
        await result.current.flush();
      });
      expect(messages.get(second)).toEqual([]);
    },
  );
});
