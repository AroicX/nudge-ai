import { describe, expect, it, vi } from 'vitest';

import { createVoiceTaskBridge } from './voice-task-bridge';

describe('voice task bridge', () => {
  it('runs one valid browser intent and returns its verified result', async () => {
    const runBrowserTask = vi.fn().mockResolvedValue({ ok: true, message: 'Found three kettles.' });
    const returnResult = vi.fn();
    const bridge = createVoiceTaskBridge({ runBrowserTask, returnResult, stopTask: vi.fn() });

    await bridge({ type: 'function.intent', name: 'run_browser_task', arguments: { goal: 'Find a kettle' }, callId: 'call-1' });

    expect(runBrowserTask).toHaveBeenCalledWith('Find a kettle');
    expect(returnResult).toHaveBeenCalledWith('call-1', { ok: true, message: 'Found three kettles.' });
  });

  it('deduplicates repeated call IDs and returns the cached outcome', async () => {
    const runBrowserTask = vi.fn().mockResolvedValue({ ok: true, message: 'Done.' });
    const returnResult = vi.fn();
    const bridge = createVoiceTaskBridge({ runBrowserTask, returnResult, stopTask: vi.fn() });
    const intent = { type: 'function.intent' as const, name: 'run_browser_task', arguments: { goal: 'Open account settings' }, callId: 'call-1' };

    await Promise.all([bridge(intent), bridge(intent)]);

    expect(runBrowserTask).toHaveBeenCalledOnce();
    expect(returnResult).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed browser goals without starting a task', async () => {
    const runBrowserTask = vi.fn();
    const returnResult = vi.fn();
    const bridge = createVoiceTaskBridge({ runBrowserTask, returnResult, stopTask: vi.fn() });

    await bridge({ type: 'function.intent', name: 'run_browser_task', arguments: { goal: '' }, callId: 'call-1' });

    expect(runBrowserTask).not.toHaveBeenCalled();
    expect(returnResult).toHaveBeenCalledWith('call-1', { ok: false, message: 'I could not understand the browser task.' });
  });

  it('returns an unavailable-tab failure without inventing success', async () => {
    const runBrowserTask = vi.fn().mockRejectedValue(new Error('No active browser tab is available.'));
    const returnResult = vi.fn();
    const bridge = createVoiceTaskBridge({ runBrowserTask, returnResult, stopTask: vi.fn() });

    await bridge({ type: 'function.intent', name: 'run_browser_task', arguments: { goal: 'Read this page' }, callId: 'call-1' });

    expect(returnResult).toHaveBeenCalledWith('call-1', { ok: false, message: 'No active browser tab is available.' });
  });

  it('shares Stop cancellation without submitting generic transcripts', async () => {
    const stopTask = vi.fn();
    const runBrowserTask = vi.fn();
    const bridge = createVoiceTaskBridge({ runBrowserTask, returnResult: vi.fn(), stopTask });

    await bridge({ type: 'transcript', role: 'user', text: 'stop task', final: true });
    await bridge({ type: 'transcript', role: 'user', text: 'Find an iPhone', final: true });

    expect(stopTask).toHaveBeenCalledOnce();
    expect(runBrowserTask).not.toHaveBeenCalled();
  });
});
