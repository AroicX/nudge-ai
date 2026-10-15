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
  onClearHistory,
}: {
  open: boolean;
  onClose(): void;
  onSave(key: string): void;
  onClear(): void;
  selection: ProviderSelection;
  health?: ProviderHealth | undefined;
  onSelection(value: ProviderSelection): void;
  onRefresh(): void;
  onClearHistory(): void;
}) {
  const [key, setKey] = useState('');
  const [viewProvider, setViewProvider] = useState(selection.provider);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setViewProvider(selection.provider);
      inputRef.current?.focus();
    }
  }, [open, selection.provider]);
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
          <button type="button" className={viewProvider === 'openai' ? '' : 'secondary'} onClick={() => { setViewProvider('openai'); onSelection({ provider: 'openai' }); }}>Use OpenAI</button>
          <button
            type="button"
            className={viewProvider === 'ollama' ? '' : 'secondary'}
            onClick={() => {
              setViewProvider('ollama');
              const model = health?.ollama.models[0];
              if (model) onSelection({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model });
            }}
          >
            Use Ollama
          </button>
        </div>
        {viewProvider === 'openai' ? (
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
            <input id="ollama-url" value={selection.provider === 'ollama' ? selection.baseUrl : 'http://127.0.0.1:11434'} readOnly />
            {health?.ollama.models.length ? (
              <>
                <label htmlFor="ollama-model">Model</label>
                <select
                  id="ollama-model"
                  value={selection.provider === 'ollama' ? selection.model : health.ollama.models[0]}
                  onChange={(event) => onSelection({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: event.target.value })}
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
          {viewProvider === 'openai' ? <><button
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
          <button type="button" className="secondary" onClick={onClearHistory}>Clear history</button>
        </div>
      </section>
    </div>
  );
}
