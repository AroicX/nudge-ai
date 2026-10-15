import { describe, expect, it, vi } from 'vitest';

import { createVoiceTaskBridge } from './voice-task-bridge';

describe('voice task bridge', () => {
  it('routes final spoken turns into the shared text task entrypoint', () => {
    const submitTurn = vi.fn();
    const bridge = createVoiceTaskBridge({ submitTurn, stopTask: vi.fn(), reportIntent: vi.fn() });
    bridge({ type: 'transcript', role: 'user', text: 'Find an iPhone', final: true });
    expect(submitTurn).toHaveBeenCalledWith('Find an iPhone');
  });

  it('shares Stop cancellation and never owns a page adapter', () => {
    const stopTask = vi.fn();
    const reportIntent = vi.fn();
    const bridge = createVoiceTaskBridge({ submitTurn: vi.fn(), stopTask, reportIntent });
    bridge({ type: 'transcript', role: 'user', text: 'stop task', final: true });
    bridge({
      type: 'function.intent',
      name: 'browse',
      arguments: { goal: 'search' },
      callId: 'call-1',
    });
    expect(stopTask).toHaveBeenCalledOnce();
    expect(reportIntent).toHaveBeenCalledWith('browse', { goal: 'search' }, 'call-1');
  });
});
