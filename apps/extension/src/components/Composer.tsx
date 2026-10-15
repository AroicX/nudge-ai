import { useState, type FormEvent } from 'react';

import {
  PromptInput,
  PromptInputAction,
  PromptInputActionGroup,
  PromptInputActions,
  PromptInputTextarea,
} from '../../components/nexus-ui/prompt-input';

export function Composer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend(text: string): void;
  onStop(): void;
}) {
  const [text, setText] = useState('');
  const submitText = () => {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    submitText();
  };
  return (
    <form aria-label="Message Nudge" className="composer" onSubmit={submit}>
      <label htmlFor="nudge-message">Tell Nudge what to do</label>
      <PromptInput onSubmit={submitText}>
        <PromptInputTextarea
          id="nudge-message"
          aria-label="Tell Nudge what to do"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <PromptInputActions>
          <PromptInputActionGroup />
          <PromptInputActionGroup>
            {busy ? (
              <PromptInputAction asChild tooltip="Stop the browser task">
                <button type="button" className="secondary" onClick={onStop}>
                  Stop
                </button>
              </PromptInputAction>
            ) : null}
            <PromptInputAction asChild tooltip="Send message">
              <button type="submit" disabled={!text.trim()}>
                Send
              </button>
            </PromptInputAction>
          </PromptInputActionGroup>
        </PromptInputActions>
      </PromptInput>
    </form>
  );
}
