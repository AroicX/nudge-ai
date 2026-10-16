import type { VoiceEvent } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createVoiceConversation, routeComposerText } from './voice-conversation';

describe('voice conversation integration', () => {
  it('commits a final user transcript once without invoking the text runner', () => {
    const addTurn = vi.fn();
    const conversation = createVoiceConversation({ addTurn, setLiveTranscript: vi.fn() });
    const event = {
      type: 'transcript', role: 'user', text: 'Find a kettle', final: true,
      eventId: 'evt_1', itemId: 'item_1',
    } as VoiceEvent;

    conversation.handle(event);
    conversation.handle(event);

    expect(addTurn).toHaveBeenCalledOnce();
    expect(addTurn).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', text: 'Find a kettle' }));
  });

  it('commits assistant text only after playback completes', () => {
    const addTurn = vi.fn();
    const conversation = createVoiceConversation({ addTurn, setLiveTranscript: vi.fn() });
    conversation.handle({
      type: 'transcript', role: 'assistant', text: 'Found it.', final: true,
      eventId: 'evt_text', itemId: 'item_a', responseId: 'response_1',
    } as VoiceEvent);
    expect(addTurn).not.toHaveBeenCalled();

    conversation.handle({
      type: 'speech.stopped', role: 'assistant',
      eventId: 'evt_stop', responseId: 'response_1',
    } as VoiceEvent);
    expect(addTurn).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', text: 'Found it.' }));
  });

  it('routes typed input into an active voice call', () => {
    const sendRealtimeText = vi.fn();
    const sendTextTask = vi.fn();

    routeComposerText('Hello', { voiceActive: true, sendRealtimeText, sendTextTask });
    routeComposerText('Typed only', { voiceActive: false, sendRealtimeText, sendTextTask });

    expect(sendRealtimeText).toHaveBeenCalledWith('Hello');
    expect(sendTextTask).toHaveBeenCalledWith('Typed only');
  });
});
