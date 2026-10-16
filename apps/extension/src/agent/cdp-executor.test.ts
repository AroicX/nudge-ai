import { describe, expect, it, vi } from 'vitest';

import { ALLOWED_CDP_METHODS, createCdpExecutor } from './cdp-executor';

function fakeDebugger(options: { attachError?: string } = {}) {
  const listeners = new Set<(source: { tabId?: number }, reason: string) => void>();
  const api = {
    commands: [] as Array<{ method: string; params: Record<string, unknown> }>,
    attach: vi.fn(async () => {
      if (options.attachError) throw new Error(options.attachError);
    }),
    detach: vi.fn(async () => undefined),
    sendCommand: vi.fn(async (_target: unknown, method: string, params?: Record<string, unknown>) => {
      api.commands.push({ method, params: params ?? {} });
      return method === 'Page.captureScreenshot' ? { data: 'AAAA' } : {};
    }),
    onDetach: {
      addListener: (listener: (source: { tabId?: number }, reason: string) => void) => listeners.add(listener),
      removeListener: (listener: (source: { tabId?: number }, reason: string) => void) => listeners.delete(listener),
    },
    fireDetach: (tabId: number, reason: string) => listeners.forEach((listener) => listener({ tabId }, reason)),
  };
  return api;
}

const granted = { contains: vi.fn(async () => true) };

describe('CDP executor', () => {
  it('only sends allow-listed methods', async () => {
    const api = fakeDebugger();
    const cdp = createCdpExecutor(api, granted);
    await cdp.attach(4);
    await cdp.click(10, 20);
    await cdp.key('Control+A');
    await cdp.insertText('Hi');
    expect(api.commands.every((command) => ALLOWED_CDP_METHODS.includes(command.method as never))).toBe(true);
    expect(ALLOWED_CDP_METHODS).toEqual(['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Page.captureScreenshot']);
    expect(() => (cdp as unknown as { send: (method: string) => unknown }).send).toBeTypeOf('function');
    await expect((cdp as unknown as { send: (method: string) => Promise<unknown> }).send('Runtime.evaluate')).rejects.toThrow(/not allowed/);
  });

  it('attaches only to the requested tab and detaches', async () => {
    const api = fakeDebugger();
    const cdp = createCdpExecutor(api, granted);
    await cdp.attach(4);
    expect(api.attach).toHaveBeenCalledWith({ tabId: 4 }, '1.3');
    expect(cdp.attachedTabId()).toBe(4);
    await cdp.detach();
    expect(api.detach).toHaveBeenCalledWith({ tabId: 4 });
    expect(cdp.attachedTabId()).toBeUndefined();
    await expect(cdp.click(1, 1)).rejects.toThrow(/not attached/);
  });

  it('reports a user-cancelled session as lost capability', async () => {
    const api = fakeDebugger();
    const cdp = createCdpExecutor(api, granted);
    const lost = vi.fn();
    cdp.onLost(lost);
    await cdp.attach(4);
    api.fireDetach(4, 'canceled_by_user');
    expect(lost).toHaveBeenCalledWith('canceled_by_user');
    expect(cdp.attachedTabId()).toBeUndefined();
  });

  it('reports unavailability when the permission is missing or attach fails', async () => {
    expect(await createCdpExecutor(fakeDebugger(), { contains: vi.fn(async () => false) }).available()).toBe(false);
    const failing = createCdpExecutor(fakeDebugger({ attachError: 'Another debugger is already attached' }), granted);
    await expect(failing.attach(4)).rejects.toThrow(/DevTools|another debugger/i);
  });

  it('sends clickCount 2 for double clicks and modifier bitmask for chords', async () => {
    const api = fakeDebugger();
    const cdp = createCdpExecutor(api, granted);
    await cdp.attach(4);
    await cdp.click(5, 6, { double: true });
    const presses = api.commands.filter((command) => command.params.type === 'mousePressed');
    expect(presses.map((command) => command.params.clickCount)).toEqual([1, 2]);
    api.commands.length = 0;
    await cdp.key('Control+A');
    const down = api.commands.find((command) => command.params.type === 'rawKeyDown');
    expect(down?.params).toMatchObject({ modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  });

  it('drags with intermediate moves while the button is held', async () => {
    const api = fakeDebugger();
    const cdp = createCdpExecutor(api, granted);
    await cdp.attach(4);
    await cdp.drag({ x: 0, y: 0 }, { x: 100, y: 0 });
    const types = api.commands.map((command) => command.params.type);
    expect(types[0]).toBe('mouseMoved');
    expect(types).toContain('mousePressed');
    expect(types.at(-1)).toBe('mouseReleased');
    expect(api.commands.filter((command) => command.params.type === 'mouseMoved' && command.params.buttons === 1).length).toBeGreaterThanOrEqual(10);
  });

  it('fails a hung command with a timeout instead of stalling the task', async () => {
    vi.useFakeTimers();
    const api = fakeDebugger();
    api.sendCommand.mockImplementation(() => new Promise(() => undefined));
    const cdp = createCdpExecutor(api, granted, { commandTimeoutMs: 1_000 });
    await cdp.attach(4);
    const pending = cdp.captureScreenshot();
    const assertion = expect(pending).rejects.toThrow(/Page.captureScreenshot timed out/);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
    vi.useRealTimers();
  });
});
