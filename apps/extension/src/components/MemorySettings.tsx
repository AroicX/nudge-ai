import { Activity, Archive, Brain, Database, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MemoryClient } from '../api/memory-client';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';
import { ConfirmDelete } from './ConfirmDelete';

const client = new MemoryClient(
  import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
  import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
);
export function MemorySettings({ workspace }: { workspace: MemoryWorkspace }) {
  const [preferences, setPreferences] = useState<{
    autoRemember: boolean;
    localDiagnostics: boolean;
  }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [days, setDays] = useState(90);
  useEffect(() => {
    void client
      .preferences()
      .then(setPreferences)
      .catch(() =>
        setError('Connect to the updated local Nudge server to change memory settings.'),
      );
  }, []);
  const save = async (value: NonNullable<typeof preferences>) => {
    setPending(true);
    setError('');
    try {
      setPreferences(await client.savePreferences(value));
    } catch {
      setError('Could not save the setting. Your previous choice remains active.');
    } finally {
      setPending(false);
    }
  };
  const oldChats = workspace.chats.filter(
    (chat) =>
      chat.id !== workspace.activeId && Date.parse(chat.updatedAt) < Date.now() - days * 86400000,
  );
  return (
    <div className="memory-settings">
      <div className="memory-stats" aria-label="Saved memory overview">
        <span>
          <Database aria-hidden="true" size={20} />
          <strong>{workspace.chats.length}</strong> chats
        </span>
        <span>
          <Brain aria-hidden="true" size={20} />
          <strong>{workspace.facts.length}</strong> saved details
        </span>
        <span>
          <Archive aria-hidden="true" size={20} />
          <strong>{workspace.documents.length}</strong> documents
        </span>
      </div>
      <section className="memory-setting-card">
        <ShieldCheck aria-hidden="true" size={22} />
        <div>
          <h3>Your memory stays on this computer</h3>
          <p>
            Chats, profile details, and document text are saved locally. Ollama processes them
            locally. Selecting OpenAI sends the relevant request context to OpenAI.
          </p>
        </div>
      </section>
      <label className="memory-toggle">
        <span>
          <strong>Automatically remember useful details</strong>
          <small>
            Save clear personal details from new messages. Turning this off keeps existing saved
            details and chat history.
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={preferences?.autoRemember ?? false}
          disabled={!preferences || pending}
          onChange={(event) => void save({ ...preferences!, autoRemember: event.target.checked })}
        />
      </label>
      <label className="memory-toggle">
        <span>
          <strong>Local performance diagnostics</strong>
          <small>
            Log model timing and token counts to the local server console. No chat text or external
            analytics.
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={preferences?.localDiagnostics ?? false}
          disabled={!preferences || pending}
          onChange={(event) =>
            void save({ ...preferences!, localDiagnostics: event.target.checked })
          }
        />
      </label>
      <section className="memory-setting-card">
        <Activity aria-hidden="true" size={22} />
        <div>
          <h3>Device-friendly execution</h3>
          <p>
            One browser task runs at a time. Conversation replies are serialized across Nudge
            windows. Provider rate limits are reported when a request is rejected; no quota is
            estimated.
          </p>
        </div>
      </section>
      <section className="memory-retention">
        <h3>Clean up older chats</h3>
        <p>
          Keep everything by default. Review older conversations before deleting them. The current
          chat and uploaded documents are kept.
        </p>
        <label>
          Last updated more than
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={30}>30 days ago</option>
            <option value={90}>90 days ago</option>
            <option value={365}>1 year ago</option>
          </select>
        </label>
        <p>
          {oldChats.length} {oldChats.length === 1 ? 'chat matches' : 'chats match'} this period.
        </p>
        {oldChats.length ? (
          <details>
            <summary>Review matching chats</summary>
            <ul>
              {oldChats.map((chat) => (
                <li key={chat.id}>{chat.title}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <ConfirmDelete
          title={`Delete ${oldChats.length} older chats?`}
          description="This removes those conversations, their cached copies, and profile details derived from them. This cannot be undone."
          onConfirm={() => {
            setPending(true);
            void (async () => {
              try {
                for (const chat of oldChats) {
                  if ((await workspace.deleteChat(chat.id, Date.now() - days * 86400000)) === false)
                    throw new Error('Deletion failed');
                }
              } catch {
                setError(
                  'Cleanup stopped because a chat could not be deleted. Review the remaining chats and try again.',
                );
              } finally {
                setPending(false);
              }
            })();
          }}
        >
          <button type="button" disabled={pending || !oldChats.length}>
            Delete matching chats
          </button>
        </ConfirmDelete>
      </section>
      {error ? (
        <p role="alert" className="provider-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
