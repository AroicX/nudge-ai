// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSharedTheme } from './use-shared-theme';
import { useFollowLatest } from './use-follow-latest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('shares appearance changes across mounted surfaces and the document', async () => {
  const listeners = new Set<
    (changes: Record<string, { newValue: unknown }>, area: string) => void
  >();
  const set = vi.fn(async (value: Record<string, unknown>) => {
    for (const listener of listeners)
      listener({ nudgeTheme: { newValue: value.nudgeTheme } }, 'local');
  });
  vi.stubGlobal('browser', {
    storage: {
      local: { get: async () => ({ nudgeTheme: 'dark' }), set },
      onChanged: {
        addListener: (
          listener: (changes: Record<string, { newValue: unknown }>, area: string) => void,
        ) => listeners.add(listener),
        removeListener: (
          listener: (changes: Record<string, { newValue: unknown }>, area: string) => void,
        ) => listeners.delete(listener),
      },
    },
  });
  const first = renderHook(useSharedTheme);
  const second = renderHook(useSharedTheme);
  await waitFor(() => expect(first.result.current.theme).toBe('dark'));
  act(() => first.result.current.toggle());
  await waitFor(() => expect(second.result.current.theme).toBe('light'));
  expect(document.documentElement.dataset.nudgeTheme).toBe('light');
  expect(set).toHaveBeenCalledWith({ nudgeTheme: 'light' });
});
it('follows content growth, preserves manual reading, and resumes on jump', () => {
  let resized: () => void = () => undefined;
  const scrollTo = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback();
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1200);
  const content = { current: document.createElement('section') };
  const hook = renderHook(() => useFollowLatest(content, true));
  expect(scrollTo).toHaveBeenCalled();
  scrollTo.mockClear();
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(200);
  act(() => window.dispatchEvent(new Event('scroll')));
  act(() => resized());
  expect(scrollTo).not.toHaveBeenCalled();
  expect(hook.result.current.showJump).toBe(true);
  act(() => hook.result.current.jump());
  expect(scrollTo).toHaveBeenCalled();
  expect(hook.result.current.showJump).toBe(false);
});
