import { useState } from 'react';

export function ProviderSettings({
  onSave,
  onClear,
}: {
  onSave(key: string): void;
  onClear(): void;
}) {
  const [key, setKey] = useState('');
  return (
    <details className="settings">
      <summary>OpenAI connection</summary>
      <p>Nudge uses the local default key unless you provide a session-only replacement.</p>
      <label htmlFor="provider-key">OpenAI API key</label>
      <input
        id="provider-key"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <div className="settings__actions">
        <button type="button" disabled={key.trim().length < 8} onClick={() => onSave(key.trim())}>
          Use this key
        </button>
        <button type="button" className="secondary" onClick={onClear}>
          Use local default
        </button>
      </div>
    </details>
  );
}
