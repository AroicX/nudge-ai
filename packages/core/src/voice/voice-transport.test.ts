import { VoiceEventSchema, VoiceSessionStateSchema } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

describe('voice contracts', () => {
  it.each([
    'idle',
    'connecting',
    'listening',
    'user-speaking',
    'assistant-speaking',
    'interrupted',
    'reconnecting',
    'failed',
    'ended',
  ])('accepts the %s lifecycle state', (state) => {
    expect(VoiceSessionStateSchema.parse(state)).toBe(state);
  });

  it('rejects unknown fields at the transport boundary', () => {
    expect(() =>
      VoiceEventSchema.parse({ type: 'state', state: 'listening', secret: 'nope' }),
    ).toThrow();
  });
});
