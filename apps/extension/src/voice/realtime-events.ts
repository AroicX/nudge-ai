import { VoiceEventSchema, type VoiceEvent } from '@nudge/contracts';

export function parseRealtimeEvent(input: unknown): VoiceEvent[] {
  if (!input || typeof input !== 'object') return [];
  const event = input as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (event.type === 'input_audio_buffer.speech_started')
    candidates.push(
      { type: 'speech.started', role: 'user' },
      { type: 'state', state: 'user-speaking' },
    );
  if (event.type === 'input_audio_buffer.speech_stopped')
    candidates.push(
      { type: 'speech.stopped', role: 'user' },
      { type: 'state', state: 'listening' },
    );
  if (event.type === 'output_audio_buffer.started')
    candidates.push(
      { type: 'speech.started', role: 'assistant' },
      { type: 'state', state: 'assistant-speaking' },
    );
  if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared')
    candidates.push(
      { type: 'speech.stopped', role: 'assistant' },
      { type: 'state', state: 'listening' },
    );
  if (event.type === 'response.output_audio_transcript.delta' && typeof event.delta === 'string')
    candidates.push({ type: 'transcript', role: 'assistant', text: event.delta, final: false });
  if (
    event.type === 'response.output_audio_transcript.done' &&
    typeof event.transcript === 'string'
  )
    candidates.push({ type: 'transcript', role: 'assistant', text: event.transcript, final: true });
  if (
    event.type === 'conversation.item.input_audio_transcription.completed' &&
    typeof event.transcript === 'string'
  )
    candidates.push({ type: 'transcript', role: 'user', text: event.transcript, final: true });
  if (
    event.type === 'response.function_call_arguments.done' &&
    typeof event.name === 'string' &&
    typeof event.call_id === 'string' &&
    typeof event.arguments === 'string'
  ) {
    try {
      candidates.push({
        type: 'function.intent',
        name: event.name,
        callId: event.call_id,
        arguments: JSON.parse(event.arguments) as Record<string, unknown>,
      });
    } catch {
      candidates.push({ type: 'error', message: 'Voice action arguments were invalid.' });
    }
  }
  if (event.type === 'error')
    candidates.push({
      type: 'error',
      message:
        typeof event.error === 'object' && event.error && 'message' in event.error
          ? String(event.error.message)
          : 'Realtime voice failed.',
    });
  return candidates.flatMap((candidate) => {
    const parsed = VoiceEventSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}
