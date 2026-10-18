import { beforeEach, expect, it, vi } from 'vitest';
const history = vi.hoisted(() => ({
  saveHistory: vi.fn(async () => {}),
  clearHistory: vi.fn(async () => {}),
}));
vi.mock('../history/history-store', () => ({ historyStore: history }));
import { useNudgeStore } from './use-nudge-store';
const source = {
  tabId: 9,
  windowId: 1,
  active: true,
  url: 'https://www.jumia.com.ng/',
  title: 'Jumia',
  domain: 'www.jumia.com.ng',
  discarded: false,
  lastSeenAt: '2026-10-17T04:00:00.000Z',
};
beforeEach(() => {
  useNudgeStore.setState({
    conversation: [],
    timeline: [],
    controller: undefined,
    pendingTaskTurnId: undefined,
  });
  vi.clearAllMocks();
});
it('attaches delayed voice source metadata to the exact request and persists it', () => {
  const store = useNudgeStore.getState();
  store.addTurn({
    id: 'voice-a',
    role: 'user',
    text: 'Find me a black iPhone',
    createdAt: source.lastSeenAt,
  });
  store.addTurn({
    id: 'voice-b',
    role: 'user',
    text: 'Another request',
    createdAt: source.lastSeenAt,
  });
  store.setTurnSources('voice-a', [source]);
  expect(useNudgeStore.getState().conversation[0]?.sources).toEqual([source]);
  expect(useNudgeStore.getState().conversation[1]?.sources).toEqual([]);
  expect(history.saveHistory).toHaveBeenLastCalledWith(
    expect.objectContaining({
      turns: expect.arrayContaining([
        expect.objectContaining({ id: 'voice-a', sources: [source] }),
      ]),
    }),
  );
});
it('does not restore a deleted request when its tab lookup resolves late', async () => {
  const store = useNudgeStore.getState();
  store.addTurn({ id: 'voice-a', role: 'user', text: 'Hello', createdAt: source.lastSeenAt });
  await store.clearHistory();
  store.setTurnSources('voice-a', [source]);
  expect(useNudgeStore.getState().conversation).toEqual([]);
});

it('keeps progress on its initiating request across casual chat and subsequent tasks', () => {
  const store = useNudgeStore.getState();
  const snapshot = {
    taskId: 'task-a',
    status: 'running' as const,
    startedAt: 1000,
    plan: [],
    memorySummary: { recordCount: 0, issues: [] },
    capability: 'dom_only' as const,
    timeline: [{ id: 'a', label: 'Reading page', status: 'active' as const, startedAt: 1000 }],
  };
  store.addTurn({
    id: 'request-a',
    role: 'user',
    text: 'Find a phone',
    createdAt: source.lastSeenAt,
  });
  store.setController(snapshot);
  store.addTurn({ id: 'casual', role: 'user', text: 'Thanks', createdAt: source.lastSeenAt });
  store.setController({
    ...snapshot,
    status: 'completed',
    completedAt: 6000,
    timeline: [{ ...snapshot.timeline[0]!, status: 'completed', completedAt: 6000 }],
  });
  expect(useNudgeStore.getState().conversation[0]?.progress).toMatchObject({
    taskId: 'task-a',
    status: 'completed',
    startedAt: 1000,
    completedAt: 6000,
  });
  expect(useNudgeStore.getState().conversation[1]?.progress).toBeUndefined();
  store.addTurn({
    id: 'request-b',
    role: 'user',
    text: 'Find a kettle',
    createdAt: source.lastSeenAt,
  });
  store.setController({ ...snapshot, taskId: 'task-b', startedAt: 7000, timeline: [] });
  expect(useNudgeStore.getState().conversation[0]?.progress?.taskId).toBe('task-a');
  expect(useNudgeStore.getState().conversation[2]?.progress).toMatchObject({
    taskId: 'task-b',
    steps: [],
  });
});

it('does not attach another panel task to an unrelated hydrated request', () => {
  useNudgeStore.setState({
    conversation: [
      { id: 'old', role: 'user', text: 'Old task', createdAt: source.lastSeenAt, sources: [] },
    ],
  });
  useNudgeStore.getState().setController({
    taskId: 'other-panel',
    status: 'running',
    plan: [],
    memorySummary: { recordCount: 0, issues: [] },
    capability: 'dom_only',
    timeline: [],
  });
  expect(useNudgeStore.getState().conversation[0]?.progress).toBeUndefined();
});

it('deduplicates stable controller announcements across panel broadcasts', () => {
  const turn = {
    id: 'task:shared:report',
    role: 'assistant' as const,
    text: 'Completed once',
    createdAt: source.lastSeenAt,
    sources: [],
  };
  useNudgeStore.getState().addTurn(turn);
  useNudgeStore.getState().addTurn({ ...turn });
  expect(useNudgeStore.getState().conversation.filter((item) => item.id === turn.id)).toHaveLength(
    1,
  );
});
