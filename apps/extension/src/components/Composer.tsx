import type { VoiceSessionState } from '@nudge/contracts';
import { AudioLines, Mic, Send, Square, X } from 'lucide-react';
import { type FormEvent } from 'react';

import { VoiceWaveform } from './VoiceWaveform';

export function Composer({
  busy,
  voiceState,
  draft,
  showRealtimeVoice,
  dictating,
  onSend,
  onDraftChange,
  onDictate,
  onStop,
  onStartVoice,
  onEndVoice,
}: {
  busy: boolean;
  voiceState: VoiceSessionState;
  draft: string;
  showRealtimeVoice: boolean;
  dictating: boolean;
  onSend(text: string): void;
  onDraftChange(text: string): void;
  onDictate(): void;
  onStop(): void;
  onStartVoice(): void;
  onEndVoice(): void;
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
      {showRealtimeVoice && voiceActive ? (
        <VoiceWaveform state={voiceState} size={96} floating />
      ) : null}
      <input
        id="nudge-message"
        aria-label="Tell Nudge what to do"
        placeholder={busy ? 'Change or add to the task' : 'Ask Nudge to do something'}
        autoComplete="off"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <div className="composer__actions">
        <button
          type="button"
          className={`icon-button icon-button--quiet${dictating ? ' is-recording' : ''}`}
          aria-label={dictating ? 'Finish dictation' : 'Dictate message'}
          onClick={onDictate}
        >
          {dictating ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
        </button>
        {showRealtimeVoice && voiceActive ? (
          <button
            type="button"
            className="icon-button icon-button--danger"
            aria-label="End voice call"
            onClick={onEndVoice}
          >
            <X size={18} />
          </button>
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
        {busy ? (
          <>
            {draft.trim() ? (
              <button type="submit" className="icon-button icon-button--send" aria-label="Send update">
                <Send size={18} />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button icon-button--send"
              aria-label="Stop"
              onClick={onStop}
            >
              <Square size={16} fill="currentColor" />
            </button>
          </>
        ) : (
          <button
            type="submit"
            className="icon-button icon-button--send"
            aria-label="Send message"
            disabled={!draft.trim()}
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
