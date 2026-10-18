import { describe, expect, it, vi } from 'vitest';
import { DeferredTasks, parseDeferredTask } from './deferred-tasks';

const now = new Date(2026, 9, 18, 12).getTime();
describe('deferred browser tasks', () => {
  it('distinguishes execution timing from calendar event timing', () => {
    expect(parseDeferredTask('in 10 minutes, check this page', now)).toEqual({
      kind: 'schedule',
      instruction: 'check this page',
      runAt: now + 600000,
    });
    expect(parseDeferredTask('schedule a meeting on my calendar tomorrow at 9 am', now)).toEqual({
      kind: 'ordinary',
    });
    expect(parseDeferredTask('tomorrow at 9:30 am, check this page', now)).toMatchObject({
      kind: 'schedule',
      runAt: new Date(2026, 9, 19, 9, 30).getTime(),
    });
    expect(parseDeferredTask('in a while, check this page', now).kind).toBe('clarify');
  });
  it('persists, queues while busy, binds saved URL/provider and does not replay duplicate alarms', async () => {
    let busy = true;
    let saved: unknown;
    const start = vi.fn(async () => 'started' as const);
    const open = vi.fn(async () => ({ tabId: 8, url: 'https://example.com/a' }));
    const scheduler = new DeferredTasks({
      load: async () => saved,
      save: async (jobs) => {
        saved = structuredClone(jobs);
      },
      alarm: vi.fn(async () => {}),
      clearAlarm: vi.fn(async () => {}),
      tabs: {
        list: async () => [{ tabId: 1, url: 'https://example.com/a', title: 'A' }],
        open,
        waitForComplete: async () => {},
      },
      provider: () => 'ollama',
      snapshot: () => ({ status: busy ? 'running' : 'idle' }),
      start,
      emit: vi.fn(),
      clock: () => now,
      id: () => 'job1',
    });
    await scheduler.restore();
    await scheduler.instruct('in 1 minute, check this page', 1);
    expect(saved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'ollama', originUrl: 'https://example.com/a' }),
      ]),
    );
    await scheduler.runDue(now + 60000);
    expect(start).not.toHaveBeenCalled();
    busy = false;
    await scheduler.runDue(now + 60000);
    await scheduler.runDue(now + 60000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({
      id: 'job1',
      instruction: 'check this page',
      originTabId: 1,
      provider: 'ollama',
    });
    expect(open).not.toHaveBeenCalled();
  });
});

function fixture(
  options: {
    saved?: unknown;
    changedUrl?: boolean;
    fail?: boolean;
    activeSnapshot?: { taskId: string; status: string };
  } = {},
) {
  let saved = options.saved;
  const start = vi.fn(async () => {
    if (options.fail) throw new Error('Nudge server is unavailable');
    return 'started' as const;
  });
  const open = vi.fn(async () => ({ tabId: 8 }));
  const emit = vi.fn();
  const alarm = vi.fn(async () => {});
  const scheduler = new DeferredTasks({
    load: async () => saved,
    save: async (jobs) => {
      saved = structuredClone(jobs);
    },
    alarm,
    clearAlarm: vi.fn(async () => {}),
    tabs: {
      list: async () => [
        {
          tabId: 1,
          url: options.changedUrl ? 'https://example.com/other' : 'https://example.com/a',
        },
      ],
      open,
      waitForComplete: async () => {},
    },
    provider: () => 'openai',
    snapshot: () => options.activeSnapshot ?? { status: 'idle' },
    start,
    emit,
    clock: () => now,
    id: () => 'job1',
  });
  return { scheduler, start, open, emit, alarm };
}
const pendingJob = {
  id: 'job1',
  instruction: 'check this page',
  runAt: now,
  originTabId: 1,
  originUrl: 'https://example.com/a',
  provider: 'ollama',
  status: 'pending',
};
it('opens the retained URL when the originating tab navigated elsewhere', async () => {
  const { scheduler, start, open } = fixture({ saved: [pendingJob], changedUrl: true });
  await scheduler.restore();
  await scheduler.runDue();
  expect(open).toHaveBeenCalledWith('https://example.com/a');
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ originTabId: 8, provider: 'ollama' }),
  );
});
it('never replays a running task after restart and recreates pending alarms', async () => {
  const { scheduler, start, alarm } = fixture({
    saved: [
      { ...pendingJob, status: 'running' },
      { ...pendingJob, id: 'job2' },
    ],
  });
  await scheduler.restore();
  expect(scheduler.snapshot()[0]?.status).toBe('attention');
  expect(alarm).toHaveBeenCalledTimes(1);
  await scheduler.runDue();
  expect(start).toHaveBeenCalledTimes(1);
  expect(start.mock.calls[0]).toEqual([expect.objectContaining({ id: 'job2' })]);
});
it('records a backend failure and never automatically retries it', async () => {
  const { scheduler, start } = fixture({ saved: [pendingJob], fail: true });
  await scheduler.restore();
  await scheduler.runDue();
  await scheduler.runDue();
  expect(start).toHaveBeenCalledTimes(1);
  expect(scheduler.snapshot()[0]).toMatchObject({
    status: 'failed',
    detail: 'Nudge server is unavailable',
  });
});
it('cancels pending jobs and marks overdue jobs missed without running them', async () => {
  const { scheduler, start } = fixture({
    saved: [pendingJob, { ...pendingJob, id: 'job2', runAt: now - 16 * 60000 }],
  });
  await scheduler.restore();
  await scheduler.cancel('job1');
  await scheduler.runDue();
  expect(start).not.toHaveBeenCalled();
  expect(scheduler.snapshot().map((job) => job.status)).toEqual(['cancelled', 'failed']);
});
it('ordinary calendar requests bypass scheduling, unsupported execution times explain supported syntax', async () => {
  const { scheduler, emit } = fixture();
  await scheduler.restore();
  expect(await scheduler.instruct('schedule a meeting on my calendar tomorrow at 9 am', 1)).toBe(
    false,
  );
  expect(await scheduler.instruct('tomorrow morning, check this page', 1)).toBe(true);
  expect(emit).toHaveBeenCalledWith({
    type: 'milestone',
    text: expect.stringContaining('in 10 minutes'),
  });
  expect(scheduler.snapshot()).toHaveLength(0);
});

it('captures full Ollama settings and prepares them only when dispatching', async () => {
  const selection = {
    provider: 'ollama' as const,
    model: 'qwen3:8b',
    baseUrl: 'http://127.0.0.1:11434',
  };
  const prepare = vi.fn(async () => {});
  const scheduler = new DeferredTasks({
    load: async () => [],
    save: async () => {},
    alarm: async () => {},
    clearAlarm: async () => {},
    tabs: {
      list: async () => [{ tabId: 1, url: 'https://example.com' }],
      open: async () => ({ tabId: 2 }),
      waitForComplete: async () => {},
    },
    provider: () => 'ollama',
    selection: () => selection,
    prepare,
    snapshot: () => ({ status: 'idle' }),
    start: async (input) => {
      await input.prepare?.();
      return 'started';
    },
    emit: () => {},
    clock: () => now,
  });
  await scheduler.restore();
  await scheduler.instruct('in 1 minute, check this page', 1);
  expect(prepare).not.toHaveBeenCalled();
  expect(scheduler.snapshot()[0]?.providerSelection).toEqual(selection);
  await scheduler.runDue(now + 60000);
  expect(prepare).toHaveBeenCalledWith(selection);
});

it('dismisses orphaned interrupted jobs without replay and frees a schedule slot', async () => {
  const { scheduler, start } = fixture({
    saved: Array.from({ length: 20 }, (_, i) => ({
      ...pendingJob,
      id: `job${i}`,
      status: 'running',
    })),
  });
  await scheduler.restore();
  await scheduler.cancel('job0');
  expect(scheduler.snapshot()[0]?.status).toBe('cancelled');
  await scheduler.instruct('in 1 minute, check this page', 1);
  expect(scheduler.snapshot().filter((job) => job.status === 'pending')).toHaveLength(1);
  await scheduler.runDue();
  expect(start).not.toHaveBeenCalled();
});
it('does not dismiss a matching paused or confirmation task through scheduled cancellation', async () => {
  const { scheduler } = fixture({
    saved: [{ ...pendingJob, status: 'attention' }],
    activeSnapshot: { taskId: 'job1', status: 'waiting_for_confirmation' },
  });
  await scheduler.restore();
  await scheduler.cancel('job1');
  expect(scheduler.snapshot()[0]?.status).toBe('attention');
});

it('updates pending work, runs it once now, and refuses changing running work', async () => {
  const { scheduler, start, alarm } = fixture({ saved: [{ ...pendingJob, runAt: now + 60000 }] });
  await scheduler.restore();
  await scheduler.manage('job1', 'update', { instruction: 'read this page', runAt: now + 120000 });
  expect(scheduler.snapshot()[0]).toMatchObject({
    instruction: 'read this page',
    runAt: now + 120000,
    provider: 'ollama',
  });
  expect(alarm).toHaveBeenLastCalledWith('job1', now + 120000);
  await scheduler.manage('job1', 'run');
  expect(start).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ instruction: 'read this page', provider: 'ollama' }),
  );
  await expect(scheduler.manage('job1', 'delete')).rejects.toThrow('Stop or finish');
});
it('deletes pending work so later alarms cannot execute it', async () => {
  const { scheduler, start } = fixture({ saved: [pendingJob] });
  await scheduler.restore();
  await scheduler.manage('job1', 'delete');
  await scheduler.runDue();
  expect(scheduler.snapshot()).toEqual([]);
  expect(start).not.toHaveBeenCalled();
});
it('refuses run-now while another browser task is active', async () => {
  const { scheduler, start } = fixture({
    saved: [pendingJob],
    activeSnapshot: { taskId: 'other', status: 'running' },
  });
  await scheduler.restore();
  await expect(scheduler.manage('job1', 'run')).rejects.toThrow('Finish or stop');
  expect(start).not.toHaveBeenCalled();
});
