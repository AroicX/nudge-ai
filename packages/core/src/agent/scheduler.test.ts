import { describe, expect, it } from 'vitest';

import { ActionScheduler } from './scheduler';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('ActionScheduler', () => {
  it('runs one item at a time', async () => {
    const scheduler = new ActionScheduler();
    const log: string[] = [];
    const gate = deferred<void>();
    const first = scheduler.run({ fingerprint: 'a' }, async () => {
      log.push('a:start');
      await gate.promise;
      log.push('a:end');
      return 1;
    });
    const second = scheduler.run({ fingerprint: 'b' }, async () => {
      log.push('b:start');
      return 2;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['a:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('never executes superseded items', async () => {
    const scheduler = new ActionScheduler();
    const gate = deferred<void>();
    void scheduler.run({ fingerprint: 'a' }, () => gate.promise);
    let ran = false;
    const queued = scheduler.run({ fingerprint: 'b' }, async () => {
      ran = true;
    });
    scheduler.bumpGeneration();
    gate.resolve();
    expect(await queued).toEqual({ status: 'superseded' });
    expect(ran).toBe(false);
  });

  it('marks an in-flight item uncertain after stop', async () => {
    const scheduler = new ActionScheduler();
    const gate = deferred<void>();
    const running = scheduler.run({ fingerprint: 'a' }, async () => {
      await gate.promise;
      return 'done';
    });
    await Promise.resolve();
    scheduler.bumpGeneration();
    gate.resolve();
    expect(await running).toEqual({ status: 'uncertain' });
  });

  it('reports the budget exceeded at 60 calls or 15 minutes', async () => {
    let now = 0;
    const scheduler = new ActionScheduler(() => now);
    for (let index = 0; index < 59; index += 1) await scheduler.run({ fingerprint: `f${index}` }, async () => undefined);
    expect(scheduler.budgetExceeded()).toBe(false);
    await scheduler.run({ fingerprint: 'last' }, async () => undefined);
    expect(scheduler.budgetExceeded()).toBe(true);
    scheduler.resetBudget();
    expect(scheduler.budgetExceeded()).toBe(false);
    now = 900_000;
    expect(scheduler.budgetExceeded()).toBe(true);
  });

  it('resets the repeat count on progress', async () => {
    const scheduler = new ActionScheduler();
    await scheduler.run({ fingerprint: 'same' }, async () => undefined);
    await scheduler.run({ fingerprint: 'same' }, async () => undefined);
    await scheduler.run({ fingerprint: 'same' }, async () => undefined);
    expect(scheduler.repeatCount('same')).toBe(3);
    scheduler.noteProgress();
    expect(scheduler.repeatCount('same')).toBe(0);
    await scheduler.run({ fingerprint: 'other' }, async () => undefined);
    expect(scheduler.repeatCount('same')).toBe(0);
  });

  it('tickets become stale after an instruction change', async () => {
    const scheduler = new ActionScheduler();
    let ticket: { generation: number; instructionVersion: number } | undefined;
    await scheduler.run({ fingerprint: 'a' }, async (current) => {
      ticket = current;
    });
    expect(scheduler.isCurrent(ticket!)).toBe(true);
    scheduler.bumpInstruction();
    expect(scheduler.isCurrent(ticket!)).toBe(false);
  });
});
