import type { VoiceSessionState } from '@nudge/contracts';
import { AudioLines, Mic, MicOff, PhoneOff, Send, Square } from 'lucide-react';
import { type FormEvent } from 'react';

export function Composer({
  busy,
  voiceState,
  voiceMuted,
  draft,
  showRealtimeVoice,
  dictating,
  onSend,
  onDraftChange,
  onDictate,
  onStop,
  onStartVoice,
  onEndVoice,
  onMuteVoice,
}: {
  busy: boolean;
  voiceState: VoiceSessionState;
  voiceMuted: boolean;
  draft: string;
  showRealtimeVoice: boolean;
  dictating: boolean;
  onSend(text: string): void;
  onDraftChange(text: string): void;
  onDictate(): void;
  onStop(): void;
  onStartVoice(): void;
  onEndVoice(): void;
  onMuteVoice(): void;
}) {
  const voiceActive = !['idle', 'ended', 'failed'].includes(voiceState);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    onSend(value);
    onDraftChange('');
  };

  return (
    <form aria-label="Message Nudge" className="composer" onSubmit={submit}>
      <input
        id="nudge-message"
        aria-label="Tell Nudge what to do"
        placeholder="Ask Nudge to do something"
        autoComplete="off"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <div className="composer__actions">
        {busy ? (
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label="Stop"
            onClick={onStop}
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : null}
        <button
          type="button"
          className={`icon-button icon-button--quiet${dictating ? ' is-recording' : ''}`}
          aria-label={dictating ? 'Finish dictation' : 'Dictate message'}
          onClick={onDictate}
        >
          {dictating ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
        </button>
        {showRealtimeVoice && voiceActive ? (
          <>
            <button
              type="button"
              className="icon-button icon-button--quiet"
              aria-label={voiceMuted ? 'Unmute voice call' : 'Mute voice call'}
              onClick={onMuteVoice}
            >
              {voiceMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              type="button"
              className="icon-button icon-button--active"
              aria-label="End voice call"
              onClick={onEndVoice}
            >
              <PhoneOff size={18} />
            </button>
          </>
        ) : showRealtimeVoice ? (
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label="Start voice call"
            onClick={onStartVoice}
          >
            <AudioLines size={19} />
          </button>
        ) : null}
        <button
          type="submit"
          className="icon-button icon-button--send"
          aria-label="Send message"
          disabled={!draft.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </form>
  );
}
