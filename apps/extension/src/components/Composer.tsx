import type { VoiceSessionState } from '@nudge/contracts';
import { ArrowUp, AudioLines, ImagePlus, Loader2, Mic, MicOff, Send, Square, X } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type ReactNode } from 'react';

import type { PendingImage } from '../chat/image-attachments';

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
  images = [],
  imageError,
  onAddImages,
  onRemoveImage,
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
  images?: PendingImage[];
  imageError?: string | undefined;
  onAddImages?: (files: File[]) => void;
  onRemoveImage?: (id: string) => void;
}) {
  const voiceActive = !['idle', 'ended', 'failed'].includes(voiceState);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const preparing = images.some((image) => image.status === 'preparing');
  const readyImages = images.filter((image) => image.status === 'ready');
  const canSend = Boolean(draft.trim() || readyImages.length) && !preparing;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy && !allowUpdates) return;
    if (!canSend) return;
    const value = draft.trim() || 'What is in this image?';
    onSend(value);
    onDraftChange('');
  };
  const addFiles = (files: File[]) => {
    if (onAddImages && files.length) onAddImages(files);
  };
  const onPaste = (event: ClipboardEvent) => {
    if (!onAddImages) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  };
  const onDrop = (event: DragEvent) => {
    if (!onAddImages) return;
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  };

  return (
    <form
      aria-label="Message Nudge"
      className={`composer${dragging ? ' composer--dragging' : ''}`}
      onSubmit={submit}
      onDragOver={(event) => {
        if (!onAddImages || !Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {images.length || imageError ? (
        <div className="composer__attachments" aria-label="Attached images">
          {images.map((image) => (
            <figure key={image.id} className={`composer__image composer__image--${image.status}`}>
              {image.input?.dataUrl || image.turn ? (
                <img src={image.input?.dataUrl ?? image.turn?.thumbnail} alt={image.name} />
              ) : (
                <span className="composer__image-progress" role="progressbar" aria-label={`Preparing ${image.name}`}>
                  <Loader2 size={16} className="spin" />
                </span>
              )}
              {image.error ? <figcaption role="alert">{image.error}</figcaption> : null}
              <button
                type="button"
                className="composer__image-remove"
                aria-label={`Remove ${image.name}`}
                onClick={() => onRemoveImage?.(image.id)}
              >
                <X size={12} />
              </button>
            </figure>
          ))}
          {preparing ? <span className="composer__note">Preparing image…</span> : null}
          {imageError ? (
            <p className="composer__error" role="alert">
              {imageError}
            </p>
          ) : null}
        </div>
      ) : null}
      {dragging ? <div className="composer__drop">Drop images to attach</div> : null}
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
          onPaste={onPaste}
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
          onPaste={onPaste}
        />
      )}
      {modelSelector ? <div className="composer__model">{modelSelector}</div> : null}
      <div className="composer__actions">
        {onAddImages ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              aria-label="Choose images to attach"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="icon-button icon-button--quiet"
              aria-label="Attach images"
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus size={18} />
            </button>
          </>
        ) : null}
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
            disabled={!canSend}
          >
            {fullPage ? <ArrowUp size={18} /> : <Send size={18} />}
          </button>
        )}
      </div>
    </form>
  );
}
