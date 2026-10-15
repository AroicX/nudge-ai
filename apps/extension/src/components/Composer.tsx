import { useState, type FormEvent } from 'react';

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
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText('');
  };
  return (
    <form aria-label="Message Nudge" className="composer" onSubmit={submit}>
      <label htmlFor="nudge-message">Tell Nudge what to do</label>
      <textarea id="nudge-message" value={text} onChange={(event) => setText(event.target.value)} />
      <div className="composer__actions">
        <button type="submit" disabled={!text.trim()}>
          Send
        </button>
        {busy ? (
          <button type="button" className="secondary" onClick={onStop}>
            Stop
          </button>
        ) : null}
      </div>
    </form>
  );
}
