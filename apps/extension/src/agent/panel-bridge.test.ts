import { describe, expect, it, vi } from 'vitest';

import { ControllerClient } from '../panel/controller-client';
import { createPanelBridge, type PortLike } from './panel-bridge';

function pair() {
  const panelListeners = new Set<(message: unknown) => void>();
  const backgroundListeners = new Set<(message: unknown) => void>();
  const disconnectPanel = new Set<() => void>();
  const disconnectBackground = new Set<() => void>();
  const background: PortLike = {
    name: 'nudge-panel',
    postMessage: (message) => panelListeners.forEach((listener) => listener(message)),
    onMessage: { addListener: (listener) => backgroundListeners.add(listener) },
    onDisconnect: { addListener: (listener) => disconnectBackground.add(listener) },
  };
  const panel: PortLike = {
    name: 'nudge-panel',
    postMessage: (message) => backgroundListeners.forEach((listener) => listener(message)),
    onMessage: { addListener: (listener) => panelListeners.add(listener) },
    onDisconnect: { addListener: (listener) => disconnectPanel.add(listener) },
  };
  return {
    background,
    panel,
    drop: () => {
      disconnectPanel.forEach((listener) => listener());
      disconnectBackground.forEach((listener) => listener());
    },
  };
}

function fakeController() {
  return {
    instruct: vi.fn(async () => undefined),
    control: vi.fn(),
    confirm: vi.fn(),
    answer: vi.fn(),
    capabilityGranted: vi.fn(),
    approveFallback: vi.fn(),
    requestExport: vi.fn(async () => undefined),
    snapshot: vi.fn(() => ({
      status: 'running' as const,
      plan: [],
      memorySummary: { recordCount: 2, issues: [] },
      capability: 'dom_only' as const,
      timeline: [],
    })),
  };
}

describe('panel bridge', () => {
  it('sends a full snapshot when the panel (re)connects', async () => {
    const controller = fakeController();
    const bridge = createPanelBridge(controller);
    const messages: unknown[] = [];
    const first = pair();
    bridge.connect(first.background);
    const client = new ControllerClient(() => first.panel);
    client.connect((message) => messages.push(message));
    expect(messages).toContainEqual({
      type: 'state',
      task: expect.objectContaining({ status: 'running' }),
    });

    // Panel closed and reopened.
    first.drop();
    const second = pair();
    bridge.connect(second.background);
    const reopened = new ControllerClient(() => second.panel);
    const later: unknown[] = [];
    reopened.connect((message) => later.push(message));
    expect(later).toContainEqual({
      type: 'state',
      task: expect.objectContaining({ memorySummary: { recordCount: 2, issues: [] } }),
    });
  });

  it('routes validated panel messages to the controller and drops invalid ones', () => {
    const controller = fakeController();
    const bridge = createPanelBridge(controller);
    const { background, panel } = pair();
    bridge.connect(background);
    const client = new ControllerClient(() => panel);
    client.connect(() => undefined);
    client.instruct('only include remote roles', 'voice');
    client.confirm('preview_1', true);
    client.control('stop');
    panel.postMessage({ type: 'instruct', text: 'x'.repeat(10_000), source: 'text' });
    panel.postMessage({ type: 'run_script', code: 'alert(1)' });
    expect(controller.instruct).toHaveBeenCalledTimes(1);
    expect(controller.instruct).toHaveBeenCalledWith(
      'only include remote roles',
      'voice',
      undefined,
    );
    expect(controller.confirm).toHaveBeenCalledWith('preview_1', true);
    expect(controller.control).toHaveBeenCalledWith('stop');
  });

  it('broadcasts controller messages to every connected panel', () => {
    const bridge = createPanelBridge(fakeController());
    const one = pair();
    const two = pair();
    bridge.connect(one.background);
    bridge.connect(two.background);
    const a: unknown[] = [];
    const b: unknown[] = [];
    new ControllerClient(() => one.panel).connect((message) => a.push(message));
    new ControllerClient(() => two.panel).connect((message) => b.push(message));
    bridge.emit({ type: 'milestone', text: 'Added 3 rows' });
    expect(a).toContainEqual({ type: 'milestone', text: 'Added 3 rows' });
    expect(b).toContainEqual({ type: 'milestone', text: 'Added 3 rows' });
  });

  it('client reconnects and re-sends hello after the service worker restarts', async () => {
    vi.useFakeTimers();
    const controller = fakeController();
    const bridge = createPanelBridge(controller);
    let current = pair();
    bridge.connect(current.background);
    const client = new ControllerClient(() => {
      return current.panel;
    });
    const messages: unknown[] = [];
    client.connect((message) => messages.push(message));
    const before = messages.length;
    const old = current;
    current = pair();
    bridge.connect(current.background);
    old.drop();
    await vi.advanceTimersByTimeAsync(300);
    expect(messages.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});

it('routes scheduled instructions and cancellation through the persisted queue after hydration', async () => {
  const controller = fakeController();
  const schedules = {
    ready: Promise.resolve(),
    instruct: vi.fn(async () => true),
    snapshot: () => [],
    cancel: vi.fn(async () => {}),
  };
  const bridge = createPanelBridge(controller, schedules);
  const { background, panel } = pair();
  background.sender = { url: 'chrome-extension://test/sidepanel.html?view=fullpage' };
  bridge.connect(background);
  const client = new ControllerClient(() => panel);
  const messages: unknown[] = [];
  client.connect((message) => messages.push(message));
  client.instruct('in 10 minutes, check this page', 'voice', 4);
  client.cancelSchedule('job1');
  await vi.waitFor(() =>
    expect(schedules.instruct).toHaveBeenCalledWith('in 10 minutes, check this page', 4),
  );
  expect(controller.instruct).not.toHaveBeenCalled();
  expect(schedules.cancel).toHaveBeenCalledWith('job1');
  expect(messages).toContainEqual({ type: 'schedules', jobs: [] });
  schedules.instruct.mockResolvedValue(false);
  client.instruct('schedule a meeting on my calendar', 'text', 4);
  await vi.waitFor(() =>
    expect(controller.instruct).toHaveBeenCalledWith(
      'schedule a meeting on my calendar',
      'text',
      4,
    ),
  );
});

it('does not expose schedule logs or management to compact panels', async () => {
  const schedules = {
    ready: Promise.resolve(),
    instruct: vi.fn(async () => false),
    snapshot: () => [],
    cancel: vi.fn(async () => {}),
    manage: vi.fn(async () => {}),
  };
  const bridge = createPanelBridge(fakeController(), schedules);
  const { background, panel } = pair();
  background.sender = { url: 'chrome-extension://test/sidepanel.html' };
  bridge.connect(background);
  const messages: unknown[] = [];
  const client = new ControllerClient(() => panel);
  client.connect((message) => messages.push(message));
  client.cancelSchedule('job1');
  client.manageSchedule('job1', 'delete');
  bridge.emit({ type: 'schedules', jobs: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(schedules.cancel).not.toHaveBeenCalled();
  expect(schedules.manage).not.toHaveBeenCalled();
  expect(messages).not.toContainEqual({ type: 'schedules', jobs: [] });
});
