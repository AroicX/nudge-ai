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
  fullPage = false,
  embedded = false,
}: {
  fullPage?: boolean;
  embedded?: boolean;
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
  const fields = (
    <>
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
        ) : viewProvider === 'ollama' ? (
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
        ) : <p>ChatGPT plan text is selected. Open Account in full-screen chat to manage the connection. Choose a plan model from the composer.</p>}
        {fullPage ? (
          <details>
            <summary>Set up Continue with ChatGPT</summary>
            <p>On macOS, open Terminal in your Nudge project folder and run:</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><code>{`pnpm --filter @nudge/chatgpt-host install-host -- --extension-id ${/^[a-p]{32}$/.test(globalThis.location?.hostname ?? '') ? globalThis.location.hostname : 'YOUR_EXTENSION_ID'}`}</code></pre>
            <p>Reload Nudge at chrome://extensions, open Account in full-screen chat, and choose Continue with ChatGPT. Run setup again if you move the project or change your Node installation.</p>
            <p>The companion keeps ChatGPT credentials on this computer. Eligible text uses your plan allowance; OpenAI API mode and API voice are billed separately. Connecting does not import ChatGPT history or memory.</p>
          </details>
        ) : null}
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
    </>
  );
  if (embedded) return <div className="provider-embedded">{fields}</div>;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-modal__header">
          <div>
            <h2 id="settings-title">Provider settings</h2>
            <p>Choose OpenAI or a local Ollama model. ChatGPT plan connections are managed from Account in full-screen chat.</p>
          </div>
          <button type="button" className="icon-button icon-button--quiet" aria-label="Close settings" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {fields}
      </section>
    </div>
  );
}
