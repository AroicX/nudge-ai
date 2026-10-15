import type { VoiceSessionState } from '@nudge/contracts';

import { VoiceWaveform } from './VoiceWaveform';

export function VoiceControls({
  state,
  muted,
  onStart,
  onEnd,
  onMute,
  onInterrupt,
  onPushToTalk,
}: {
  state: VoiceSessionState;
  muted: boolean;
  onStart(): void;
  onEnd(): void;
  onMute(): void;
  onInterrupt(): void;
  onPushToTalk?: (() => void) | undefined;
}) {
  const active = !['idle', 'ended', 'failed'].includes(state);
  return (
    <section className="voice-controls" aria-label="Voice call">
      <div>
        <VoiceWaveform state={state} />
        <span aria-live="polite">
          {state === 'failed' ? 'Voice unavailable — typing still works' : state.replace('-', ' ')}
        </span>
      </div>
      <div className="voice-controls__actions">
        {!active ? (
          <button type="button" onClick={onStart}>
            Start Voice
          </button>
        ) : (
          <button type="button" className="danger" onClick={onEnd}>
            End Call
          </button>
        )}
        {active ? (
          <button type="button" className="secondary" onClick={onMute}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
        ) : null}
        {state === 'assistant-speaking' ? (
          <button type="button" className="secondary" onClick={onInterrupt}>
            Interrupt
          </button>
        ) : null}
        {state === 'failed' && onPushToTalk ? (
          <button type="button" className="secondary" onClick={onPushToTalk}>
            Push to talk
          </button>
        ) : null}
      </div>
    </section>
  );
}
