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

export function VoiceWaveform({ state }: { state: VoiceSessionState }) {
  const orbState = toOrbState(state);

  return (
    <span className="voice-orb" aria-hidden="true">
      <Orb
        theme="cloud"
        size={54}
        interactive={false}
        signal={{
          state: orbState,
          inputVolume: orbState === 'listening' ? 0.35 : 0,
          outputVolume: orbState === 'speaking' ? 0.5 : 0,
        }}
      />
    </span>
  );
}
