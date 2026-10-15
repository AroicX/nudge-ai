import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ProviderSelection } from '@nudge/contracts';

export interface ProviderHealth {
  openai: { available: boolean };
  ollama: { available: boolean; models: string[]; error?: string };
}

export function ProviderSettings({
  open,
  onClose,
  onSave,
  onClear,
  selection,
  health,
  onSelection,
  onRefresh,
}: {
  open: boolean;
  onClose(): void;
  onSave(key: string): void;
  onClear(): void;
  selection: ProviderSelection;
  health?: ProviderHealth | undefined;
  onSelection(value: ProviderSelection): void;
  onRefresh(): void;
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
            <h2 id="settings-title">Provider settings</h2>
            <p>Choose OpenAI or a local Ollama model.</p>
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
        <div className="provider-choice">
          <button type="button" className={selection.provider === 'openai' ? '' : 'secondary'} onClick={() => onSelection({ provider: 'openai' })}>Use OpenAI</button>
          <button
            type="button"
            className={selection.provider === 'ollama' ? '' : 'secondary'}
            onClick={() => onSelection({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: health?.ollama.models[0] ?? 'qwen3' })}
          >
            Use Ollama
          </button>
        </div>
        {selection.provider === 'openai' ? (
          <>
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
          </>
        ) : (
          <div className="ollama-settings">
            <label htmlFor="ollama-url">Ollama URL</label>
            <input id="ollama-url" value={selection.baseUrl} readOnly />
            {health?.ollama.models.length ? (
              <>
                <label htmlFor="ollama-model">Model</label>
                <select
                  id="ollama-model"
                  value={selection.model}
                  onChange={(event) => onSelection({ ...selection, model: event.target.value })}
                >
                  {health.ollama.models.map((model) => <option key={model}>{model}</option>)}
                </select>
              </>
            ) : (
              <p className="provider-warning">No Ollama models found. Pull a tool-capable model, then refresh.</p>
            )}
            <button type="button" className="secondary" onClick={onRefresh}>Refresh models</button>
          </div>
        )}
        <div className="settings-modal__actions">
          {selection.provider === 'openai' ? <><button
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
          </> : null}
        </div>
      </section>
    </div>
  );
}
