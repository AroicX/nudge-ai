import { describe, expect, it } from 'vitest';

import { parseRealtimeEvent } from './realtime-events';

describe('parseRealtimeEvent', () => {
  it('preserves provider identity for input and output transcripts', () => {
    expect(
      parseRealtimeEvent({
        type: 'conversation.item.input_audio_transcription.completed',
        event_id: 'evt_user',
        item_id: 'item_user',
        transcript: 'Find a black kettle',
      }),
    ).toContainEqual({
      type: 'transcript',
      role: 'user',
      text: 'Find a black kettle',
      final: true,
      eventId: 'evt_user',
      itemId: 'item_user',
    });
    expect(
      parseRealtimeEvent({
        type: 'response.output_audio_transcript.done',
        event_id: 'evt_assistant',
        item_id: 'item_assistant',
        response_id: 'response_1',
        transcript: 'I found one.',
      }),
    ).toContainEqual({
      type: 'transcript',
      role: 'assistant',
      text: 'I found one.',
      final: true,
      eventId: 'evt_assistant',
      itemId: 'item_assistant',
      responseId: 'response_1',
    });
  });

  it('preserves response identity for playback and interruption events', () => {
    expect(
      parseRealtimeEvent({
        type: 'output_audio_buffer.stopped',
        event_id: 'evt_stop',
        response_id: 'response_1',
      }),
    ).toContainEqual({
      type: 'speech.stopped',
      role: 'assistant',
      eventId: 'evt_stop',
      responseId: 'response_1',
    });
    expect(
      parseRealtimeEvent({
        type: 'output_audio_buffer.cleared',
        event_id: 'evt_clear',
        response_id: 'response_1',
      }),
    ).toContainEqual({
      type: 'speech.interrupted',
      role: 'assistant',
      eventId: 'evt_clear',
      responseId: 'response_1',
    });
  });
});
