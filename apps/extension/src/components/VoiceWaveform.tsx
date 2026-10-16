import type { VoiceSessionState } from '@nudge/contracts';
import { Orb, type OrbState } from 'orb-ui';

function toOrbState(state: VoiceSessionState): OrbState {
  switch (state) {
    case 'connecting':
    case 'reconnecting':
      return 'connecting';
    case 'listening':
    case 'user-speaking':
      return 'listening';
    case 'assistant-speaking':
      return 'speaking';
    case 'interrupted':
      return 'thinking';
    case 'failed':
      return 'error';
    case 'idle':
    case 'ended':
      return 'idle';
  }
}

export function VoiceWaveform({
  state,
  size = 54,
  onEnd,
  floating = false,
}: {
  state: VoiceSessionState;
  size?: number;
  onEnd?: () => void;
  floating?: boolean;
}) {
  const orbState = toOrbState(state);
  const orb = (
    <span
      className={`voice-orb${floating ? ' composer__voice-orb' : ''}`}
      aria-hidden="true"
    >
      <Orb
        theme="cloud"
        size={size}
        interactive={false}
        signal={{
          state: orbState,
          inputVolume: orbState === 'listening' ? 0.35 : 0,
          outputVolume: orbState === 'speaking' ? 0.5 : 0,
        }}
      />
    </span>
  );

  if (!onEnd) return orb;

  return (
    <button
      type="button"
      className="voice-orb-control"
      aria-label="End voice call"
      onClick={onEnd}
    >
      {orb}
      <span className="sr-only" aria-live="polite">Voice call: {state.replace('-', ' ')}</span>
    </button>
  );
}
