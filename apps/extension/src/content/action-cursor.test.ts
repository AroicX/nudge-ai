// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { showActionCursor } from './action-cursor';

afterEach(() => vi.useRealTimers());

describe('showActionCursor', () => {
  it('moves a non-interactive cursor to the target and pulses before the action', async () => {
    vi.useFakeTimers();
    document.documentElement.innerHTML = '<body><button>Go</button></body>';
    const button = document.querySelector('button')!;
    Object.defineProperty(button, 'getBoundingClientRect', {
      value: () => ({ left: 40, top: 20, width: 100, height: 40, right: 140, bottom: 60 }),
    });

    const pending = showActionCursor(document, window, button);
    const cursor = document.querySelector('[data-nudge-root="action-cursor"]') as HTMLElement;
    expect(cursor.style.pointerEvents).toBe('none');
    expect(cursor.style.transform).toContain('translate3d(90px,40px,0)');

    await vi.advanceTimersByTimeAsync(430);
    await pending;
  });
});
