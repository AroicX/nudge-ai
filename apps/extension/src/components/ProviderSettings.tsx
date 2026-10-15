import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ProviderSettings({
  open,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  onClose(): void;
  onSave(key: string): void;
  onClear(): void;
}) {
  const [key, setKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-modal__header">
          <div>
            <h2 id="settings-title">OpenAI settings</h2>
            <p>Use the local key, or replace it for this session.</p>
          </div>
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <label htmlFor="provider-key">OpenAI API key</label>
        <input
          ref={inputRef}
          id="provider-key"
          type="password"
          autoComplete="off"
          placeholder="sk-…"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <div className="settings-modal__actions">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              onClear();
              setKey('');
              onClose();
            }}
          >
            Use local default
          </button>
          <button
            type="button"
            disabled={key.trim().length < 8}
            onClick={() => {
              onSave(key.trim());
              setKey('');
              onClose();
            }}
          >
            Use this key
          </button>
        </div>
      </section>
    </div>
  );
}
