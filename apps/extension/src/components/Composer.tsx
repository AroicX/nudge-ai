import type { VoiceSessionState } from '@nudge/contracts';
import { ArrowUp, AudioLines, Mic, MicOff, Send, Square, X } from 'lucide-react';
import { type FormEvent, type ReactNode } from 'react';

import { VoiceWaveform } from './VoiceWaveform';

export function Composer({
  busy,
  allowUpdates = true,
  fullPage = false,
  modelSelector,
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
  voiceMuted = false,
  onMuteVoice,
  onInterruptVoice,
}: {
  busy: boolean;
  allowUpdates?: boolean;
  fullPage?: boolean;
  modelSelector?: ReactNode;
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
  voiceMuted?: boolean;
  onMuteVoice?: () => void;
  onInterruptVoice?: () => void;
}) {
  const voiceActive = !['idle', 'ended', 'failed'].includes(voiceState);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy && !allowUpdates) return;
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
      {fullPage ? (
        <textarea
          id="nudge-message"
          aria-label="Tell Nudge what to do"
          placeholder={busy ? 'Change or add to the task' : 'Message Nudge…'}
          rows={1}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      ) : (
        <input
          id="nudge-message"
          aria-label="Tell Nudge what to do"
          placeholder={busy ? 'Change or add to the task' : 'Ask Nudge to do something'}
          autoComplete="off"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
        />
      )}
      {modelSelector ? <div className="composer__model">{modelSelector}</div> : null}
      <div className="composer__actions">
        {voiceActive && onMuteVoice ? (
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label={voiceMuted ? 'Unmute voice call' : 'Mute voice call'}
            aria-pressed={voiceMuted}
            onClick={onMuteVoice}
          >
            {voiceMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        ) : null}
        {voiceActive && voiceState === 'assistant-speaking' && onInterruptVoice ? (
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label="Interrupt reply"
            onClick={onInterruptVoice}
          >
            <Square size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className={`icon-button icon-button--quiet${dictating ? ' is-recording' : ''}`}
          aria-label={dictating ? 'Finish dictation' : 'Dictate message'}
          onClick={onDictate}
          disabled={voiceActive}
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
        ) : showRealtimeVoice && !fullPage ? (
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
            {draft.trim() && allowUpdates ? (
              <button
                type="submit"
                className="icon-button icon-button--send"
                aria-label="Send update"
              >
                {fullPage ? <ArrowUp size={18} /> : <Send size={18} />}
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
            {fullPage ? <ArrowUp size={18} /> : <Send size={18} />}
          </button>
        )}
      </div>
    </form>
  );
}
