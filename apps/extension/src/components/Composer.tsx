import type { VoiceSessionState } from '@nudge/contracts';
import { Mic, MicOff, PhoneOff, Send, Square } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export function Composer({
  busy,
  voiceState,
  voiceMuted,
  onSend,
  onStop,
  onStartVoice,
  onEndVoice,
  onMuteVoice,
}: {
  busy: boolean;
  voiceState: VoiceSessionState;
  voiceMuted: boolean;
  onSend(text: string): void;
  onStop(): void;
  onStartVoice(): void;
  onEndVoice(): void;
  onMuteVoice(): void;
}) {
  const [text, setText] = useState('');
  const voiceActive = !['idle', 'ended', 'failed'].includes(voiceState);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  };

  return (
    <form aria-label="Message Nudge" className="composer" onSubmit={submit}>
      <input
        id="nudge-message"
        aria-label="Tell Nudge what to do"
        placeholder="Ask Nudge to do something"
        autoComplete="off"
        value={text}
        onChange={(event) => setText(event.target.value)}
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
        {voiceActive ? (
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
        ) : (
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label="Start voice call"
            onClick={onStartVoice}
          >
            <Mic size={19} />
          </button>
        )}
        <button
          type="submit"
          className="icon-button icon-button--send"
          aria-label="Send message"
          disabled={!text.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </form>
  );
}
