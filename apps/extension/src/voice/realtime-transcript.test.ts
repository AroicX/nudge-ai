import type { VoiceEvent } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { RealtimeTranscriptReducer } from './realtime-transcript';

describe('RealtimeTranscriptReducer', () => {
  it('commits assistant text only after matching playback stops', () => {
    const reducer = new RealtimeTranscriptReducer();
    expect(
      reducer.apply({
        type: 'transcript', role: 'assistant', text: 'I found one.', final: true,
        eventId: 'evt_text', itemId: 'item_a', responseId: 'response_1',
      } as VoiceEvent),
    ).toEqual([{ role: 'assistant', text: 'I found one.', final: false, interrupted: false, itemId: 'item_a', responseId: 'response_1' }]);
    expect(
      reducer.apply({
        type: 'speech.stopped', role: 'assistant', eventId: 'evt_stop', responseId: 'response_1',
      } as VoiceEvent),
    ).toEqual([{ role: 'assistant', text: 'I found one.', final: true, interrupted: false, itemId: 'item_a', responseId: 'response_1' }]);
  });

  it('marks cleared assistant output as interrupted', () => {
    const reducer = new RealtimeTranscriptReducer();
    reducer.apply({
      type: 'transcript', role: 'assistant', text: 'A long reply', final: true,
      eventId: 'evt_text', itemId: 'item_a', responseId: 'response_1',
    } as VoiceEvent);
    expect(
      reducer.apply({
        type: 'speech.interrupted', role: 'assistant', eventId: 'evt_clear', responseId: 'response_1',
      } as VoiceEvent),
    ).toEqual([{ role: 'assistant', text: 'Reply interrupted', final: true, interrupted: true, itemId: 'item_a', responseId: 'response_1' }]);
  });

  it('ignores duplicate event IDs and late finals for interrupted output', () => {
    const reducer = new RealtimeTranscriptReducer();
    const input = {
      type: 'transcript', role: 'user', text: 'Hello', final: true,
      eventId: 'evt_user', itemId: 'item_user',
    } as VoiceEvent;
    expect(reducer.apply(input)).toHaveLength(1);
    expect(reducer.apply(input)).toEqual([]);

    reducer.apply({
      type: 'speech.interrupted', role: 'assistant', eventId: 'evt_clear', responseId: 'response_1',
    } as VoiceEvent);
    expect(
      reducer.apply({
        type: 'transcript', role: 'assistant', text: 'Late final', final: true,
        eventId: 'evt_late', itemId: 'item_a', responseId: 'response_1',
      } as VoiceEvent),
    ).toEqual([{ role: 'assistant', text: 'Reply interrupted', final: true, interrupted: true, itemId: 'item_a', responseId: 'response_1' }]);
  });
});
