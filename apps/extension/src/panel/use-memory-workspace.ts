import { useEffect, useRef, useState } from 'react';
import type { MemoryClient, MemoryDocument, MemoryFact, SavedChat } from '../api/memory-client';
import { historyStore } from '../history/history-store';
import { useNudgeStore } from '../state/use-nudge-store';

const ACTIVE = 'nudgeActiveChat';
const CACHE_LIST = 'nudgeChatList';
const generationKey = (id: string) => `nudgeChatGeneration:${id}`;
export function useMemoryWorkspace(client: MemoryClient) {
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [documents, setDocuments] = useState<MemoryDocument[]>([]);
  const active = useRef<{ id: string; generation: number } | undefined>(undefined);
  const revision = useRef(0);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const errorText = (cause: unknown) =>
    cause instanceof Error
      ? cause.message
      : 'Local memory is unavailable. Your browser cache is still saved.';
  const refresh = async () => {
    const list = await client.chats();
    setChats(list);
    await browser.storage.local.set({ [CACHE_LIST]: list });
  };
  const refreshMemory = async () => {
    const [nextFacts, nextDocuments] = await Promise.all([client.facts(), client.documents()]);
    setFacts(nextFacts);
    setDocuments(nextDocuments);
  };
  const flush = async () => {
    clearTimeout(timer.current);
    const target = active.current;
    if (!target) return;
    const messages = useNudgeStore.getState().conversation;
    const operation = queue.current
      .catch(() => undefined)
      .then(async () => {
        await client.saveMessages(target.id, messages, target.generation);
        const first = messages.find((turn) => turn.role === 'user');
        if (first && chatsRef.current.find((chat) => chat.id === target.id)?.title === 'New chat') {
          await client.renameChat(target.id, first.text.slice(0, 70));
        }
        await refresh();
      });
    queue.current = operation;
    await operation;
  };
  const loadChat = async (id: string, clearedRemotely = false) => {
    const currentRevision = ++revision.current;
    active.current = undefined;
    clearTimeout(timer.current);
    unsubscribe.current?.();
    setLoading(true);
    setError(undefined);
    const deleted = await browser.storage.local.get(`nudgeChatDeleted:${id}`);
    if (deleted[`nudgeChatDeleted:${id}`]) {
      if (currentRevision === revision.current) {
        useNudgeStore.getState().replaceConversation([]);
        setActiveId(undefined);
        setLoading(false);
        setError('This chat was deleted. Choose another chat.');
      }
      return;
    }
    const cache = historyStore.chat(id);
    const cached = await cache.loadHistory();
    const cachedMeta = await browser.storage.local.get(generationKey(id));
    let turns = clearedRemotely ? [] : cached.turns;
    if (clearedRemotely) await cache.replaceHistory({ version: 1, turns: [], timeline: [] });
    let generation =
      typeof cachedMeta[generationKey(id)] === 'number'
        ? (cachedMeta[generationKey(id)] as number)
        : 0;
    try {
      let remote = await client.messages(id);
      // Only replay this chat's offline cache if it belongs to the same clear generation.
      if (!clearedRemotely && generation === remote.generation && cached.turns.length)
        remote = await client.saveMessages(id, cached.turns, remote.generation);
      turns = remote.messages;
      generation = remote.generation;
      if (currentRevision !== revision.current) return;
      await cache.replaceHistory({ version: 1, turns, timeline: [] });
      await browser.storage.local.set({ [generationKey(id)]: generation });
    } catch (cause) {
      if (currentRevision === revision.current)
        setError(`${errorText(cause)} Showing the saved browser cache.`);
    }
    if (currentRevision !== revision.current) return;
    historyStore.useChat(id);
    useNudgeStore.getState().replaceConversation(turns);
    active.current = { id, generation };
    setActiveId(id);
    setLoading(false);
    unsubscribe.current = useNudgeStore.getState().subscribeHistory();
  };
  const choose = async (id: string) => {
    await flush();
    await browser.storage.local.set({ [ACTIVE]: id });
    await loadChat(id);
  };
  const run = async (work: () => Promise<void>) => {
    try {
      setError(undefined);
      await work();
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    }
  };
  const changeChat = (work: () => Promise<void>) =>
    run(async () => {
      await navigator.locks.request(
        'nudge-conversation-reply',
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error('Finish or stop the current reply before switching chats.');
          await work();
        },
      );
    });
  useEffect(() => {
    let alive = true;
    const stopStore = useNudgeStore.subscribe((next, previous) => {
      if (!active.current || next.conversation === previous.conversation) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush().catch((cause) => {
          if (alive) setError(`${errorText(cause)} Changes remain in the browser cache.`);
        });
      }, 300);
    });
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== 'local') return;
      if (
        typeof changes[ACTIVE]?.newValue === 'string' &&
        changes[ACTIVE].newValue !== active.current?.id
      )
        void loadChat(changes[ACTIVE].newValue).catch((cause) => setError(errorText(cause)));
      const target = active.current;
      if (target && changes[`nudgeChatDeleted:${target.id}`]?.newValue) {
        active.current = undefined;
        clearTimeout(timer.current);
        unsubscribe.current?.();
        useNudgeStore.getState().replaceConversation([]);
        setActiveId(undefined);
      } else if (
        target &&
        typeof changes[generationKey(target.id)]?.newValue === 'number' &&
        changes[generationKey(target.id)]!.newValue !== target.generation
      ) {
        active.current = undefined;
        clearTimeout(timer.current);
        void loadChat(target.id, true).catch((cause) => setError(errorText(cause)));
      }
      if (Array.isArray(changes[CACHE_LIST]?.newValue))
        setChats(changes[CACHE_LIST].newValue as SavedChat[]);
    };
    browser.storage.onChanged.addListener(changed);
    void navigator.locks.request('nudge-memory-initialize', async () => {
      const saved = await browser.storage.local.get([ACTIVE, 'nudgeSqliteMigrated', CACHE_LIST]);
      try {
        let list = await client.chats();
        // The browser migration flag can outlive a replaced or newly configured database.
        const recoveringLegacy = Boolean(saved.nudgeSqliteMigrated) && list.length === 0;
        if (!saved.nudgeSqliteMigrated || recoveringLegacy) {
          const legacy = await historyStore.loadLegacy();
          if (legacy.turns.length) {
            const migrated =
              list.find((chat) => chat.id === 'legacy-chat-v1') ??
              (await client.createChat('Previous conversation', 'legacy-chat-v1'));
            await client.saveMessages(migrated.id, legacy.turns, migrated.generation);
            list = await client.chats();
          }
          await browser.storage.local.set({ nudgeSqliteMigrated: true });
        }
        const id =
          typeof saved[ACTIVE] === 'string' && list.some((chat) => chat.id === saved[ACTIVE])
            ? (saved[ACTIVE] as string)
            : (list[0]?.id ?? (await client.createChat()).id);
        await refresh();
        await browser.storage.local.set({ [ACTIVE]: id });
        // A same-ID cache may belong to the previous database; restored legacy is authoritative.
        if (alive) await loadChat(id, recoveringLegacy);
      } catch (cause) {
        if (!alive) return;
        setError(errorText(cause));
        if (Array.isArray(saved[CACHE_LIST])) setChats(saved[CACHE_LIST] as SavedChat[]);
        if (typeof saved[ACTIVE] === 'string') await loadChat(saved[ACTIVE] as string);
        else {
          await useNudgeStore.getState().hydrateHistory();
          setLoading(false);
        }
      }
    });
    return () => {
      alive = false;
      ++revision.current;
      clearTimeout(timer.current);
      unsubscribe.current?.();
      stopStore();
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);
  return {
    chats,
    activeId,
    loading,
    error,
    facts,
    documents,
    refreshMemory: () => run(refreshMemory),
    flush,
    selectChat: (id: string) => changeChat(() => choose(id)),
    newChat: () =>
      changeChat(async () => {
        await flush();
        const chat = await client.createChat();
        await refresh();
        await choose(chat.id);
      }),
    deleteChat: (id: string, olderThan?: number) =>
      changeChat(async () => {
        await flush();
        const deletingActive = id === active.current?.id;
        if (olderThan !== undefined) {
          const latest = (await client.chats()).find((chat) => chat.id === id);
          if (latest && !(Date.parse(latest.updatedAt) < olderThan)) {
            await refresh();
            throw new Error(
              'This chat was used recently and has been kept. Review the updated list before continuing.',
            );
          }
        }
        await client.deleteChat(id);
        await browser.storage.local.set({ [`nudgeChatDeleted:${id}`]: true });
        await browser.storage.local.remove([
          `nudgeChatCache:${id}`,
          generationKey(id),
          ...(id === 'legacy-chat-v1' ? ['nudgeConversationV1'] : []),
        ]);
        if (deletingActive) {
          active.current = undefined;
          const remaining = await client.chats();
          const next = remaining[0] ?? (await client.createChat());
          await choose(next.id);
        }
        await refresh();
        await refreshMemory();
      }),
    clearChat: () =>
      changeChat(async () => {
        const target = active.current;
        if (!target) return;
        clearTimeout(timer.current);
        await queue.current.catch(() => undefined);
        await client.clearMessages(target.id);
        active.current = undefined;
        await loadChat(target.id);
      }),
    saveFact: (key: string, value: string) =>
      run(async () => {
        await client.saveFact(key, value);
        await refreshMemory();
      }),
    deleteFact: (key: string) =>
      run(async () => {
        await client.deleteFact(key);
        await refreshMemory();
      }),
    saveDocument: (filename: string, text: string) =>
      run(async () => {
        await client.saveDocument(filename, text);
        await refreshMemory();
      }),
    uploadDocument: (file: File) =>
      run(async () => {
        await client.uploadDocument(file);
        await refreshMemory();
      }),
    deleteDocument: (id: string) =>
      run(async () => {
        await client.deleteDocument(id);
        await refreshMemory();
      }),
  };
}
export type MemoryWorkspace = ReturnType<typeof useMemoryWorkspace>;
