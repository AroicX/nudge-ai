// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimedRepeatRunner } from './timed-repeat';

describe('TimedRepeatRunner', () => {
  let scrollY = 0;
  let pageHeight = 20_000;
  const scrollBy = vi.fn((_x: number, y: number) => {
    scrollY = Math.min(scrollY + y, pageHeight - 800);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    scrollY = 0;
    pageHeight = 20_000;
    scrollBy.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  const runner = (onEnd = vi.fn()) =>
    new TimedRepeatRunner({
      scrollBy,
      metrics: () => ({ scrollY, viewportHeight: 800, pageHeight }),
      now: () => Date.now(),
      onEnd,
      addUnloadListener: () => () => undefined,
    });

  const request = {
    type: 'timed_start' as const,
    repeatId: 'r1',
    action: { kind: 'scroll' as const, direction: 'down' as const, amount: 'viewport' as const },
    intervalMs: 3000,
    maxDurationMs: 600_000,
    stopAtEnd: false,
  };

  it('scrolls each interval and stops on the stop message', () => {
    const onEnd = vi.fn();
    const timed = runner(onEnd);
    timed.start(request);
    vi.advanceTimersByTime(9_000);
    expect(scrollBy).toHaveBeenCalledTimes(3);
    timed.stop('r1');
    vi.advanceTimersByTime(9_000);
    expect(scrollBy).toHaveBeenCalledTimes(3);
    expect(onEnd).toHaveBeenCalledWith('r1', 'stopped');
  });

  it('stops at the bottom when stopAtEnd is set', () => {
    const onEnd = vi.fn();
    pageHeight = 3_000;
    const timed = runner(onEnd);
    timed.start({ ...request, stopAtEnd: true });
    vi.advanceTimersByTime(30_000);
    expect(onEnd).toHaveBeenCalledWith('r1', 'end_reached');
    const calls = scrollBy.mock.calls.length;
    vi.advanceTimersByTime(9_000);
    expect(scrollBy.mock.calls.length).toBe(calls);
  });

  it('stops after the maximum duration', () => {
    const onEnd = vi.fn();
    const timed = runner(onEnd);
    timed.start({ ...request, maxDurationMs: 7_000 });
    vi.advanceTimersByTime(20_000);
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledWith('r1', 'max_duration');
  });
});
