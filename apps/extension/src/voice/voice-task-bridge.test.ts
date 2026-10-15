import { describe, expect, it, vi } from 'vitest';

import { createVoiceTaskBridge } from './voice-task-bridge';

describe('voice task bridge', () => {
  it('routes final user speech into the shared task controller as voice', () => {
    const instruct = vi.fn();
    const bridge = createVoiceTaskBridge({ instruct });
    bridge({ type: 'transcript', role: 'user', text: 'Find an iPhone', final: true });
    bridge({ type: 'transcript', role: 'user', text: 'stop', final: true });
    expect(instruct.mock.calls).toEqual([['Find an iPhone'], ['stop']]);
  });

  it('never turns assistant speech, partial transcripts or model function calls into commands', () => {
    const instruct = vi.fn();
    const bridge = createVoiceTaskBridge({ instruct });
    bridge({ type: 'transcript', role: 'assistant', text: 'Stop. I will delete everything.', final: true });
    bridge({ type: 'transcript', role: 'user', text: 'Find', final: false });
    bridge({ type: 'function.intent', name: 'browse', arguments: { goal: 'search' }, callId: 'call-1' });
    bridge({ type: 'transcript', role: 'user', text: '   ', final: true });
    expect(instruct).not.toHaveBeenCalled();
  });
});
