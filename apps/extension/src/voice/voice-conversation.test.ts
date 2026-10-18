import type { VoiceEvent } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createVoiceConversation, routeComposerText } from './voice-conversation';

describe('voice conversation integration', () => {
  it('commits a final user transcript once without invoking the text runner', () => {
    const addTurn = vi.fn();
    const conversation = createVoiceConversation({ addTurn, setLiveTranscript: vi.fn() });
    const event = {
      type: 'transcript',
      role: 'user',
      text: 'Find a kettle',
      final: true,
      eventId: 'evt_1',
      itemId: 'item_1',
    } as VoiceEvent;

    conversation.handle(event);
    conversation.handle(event);

    expect(addTurn).toHaveBeenCalledOnce();
    expect(addTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', text: 'Find a kettle' }),
    );
  });

  it('commits assistant text only after playback completes', () => {
    const addTurn = vi.fn();
    const conversation = createVoiceConversation({ addTurn, setLiveTranscript: vi.fn() });
    conversation.handle({
      type: 'transcript',
      role: 'assistant',
      text: 'Found it.',
      final: true,
      eventId: 'evt_text',
      itemId: 'item_a',
      responseId: 'response_1',
    } as VoiceEvent);
    expect(addTurn).not.toHaveBeenCalled();

    conversation.handle({
      type: 'speech.stopped',
      role: 'assistant',
      eventId: 'evt_stop',
      responseId: 'response_1',
    } as VoiceEvent);
    expect(addTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', text: 'Found it.' }),
    );
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

it('replaces interim words in the inline bubble and commits a final utterance once', () => {
  const addTurn = vi.fn();
  const setLiveVoiceTurn = vi.fn();
  const conversation = createVoiceConversation({
    addTurn,
    setLiveTranscript: vi.fn(),
    setLiveVoiceTurn,
  });
  conversation.handle({
    type: 'transcript',
    role: 'user',
    text: 'Can you',
    final: false,
    replace: true,
    itemId: 'utterance',
  });
  conversation.handle({
    type: 'transcript',
    role: 'user',
    text: 'Can you open it',
    final: false,
    replace: true,
    itemId: 'utterance',
  });
  expect(setLiveVoiceTurn).toHaveBeenLastCalledWith({ role: 'user', text: 'Can you open it' });
  expect(addTurn).not.toHaveBeenCalled();
  const final: VoiceEvent = {
    type: 'transcript',
    role: 'user',
    text: 'Can you open YouTube',
    final: true,
    itemId: 'utterance',
  };
  conversation.handle(final);
  conversation.handle(final);
  expect(addTurn).toHaveBeenCalledOnce();
  expect(setLiveVoiceTurn).toHaveBeenLastCalledWith(undefined);
  conversation.handle({ type: 'state', state: 'ended' });
  expect(setLiveVoiceTurn).toHaveBeenLastCalledWith(undefined);
});
