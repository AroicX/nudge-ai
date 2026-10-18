import { ChatGptPanel, type ChatGptPanelProps } from './ChatGptPanel';
import { ConfirmDelete } from './ConfirmDelete';
import { FileText, Pencil, Plus, Trash2, X, UploadCloud, UserRound, Settings2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { MemorySettings } from './MemorySettings';
import '../styles/memory.css';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';

export function MemoryPanel({
  workspace,
  onClose,
  chatGpt,
}: {
  chatGpt?: ChatGptPanelProps | undefined;
  workspace: MemoryWorkspace;
  onClose(): void;
}) {
  const [tab, setTab] = useState<'profile' | 'documents' | 'settings'>('profile');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [filename, setFilename] = useState('My reference');
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const act = async (work: () => Promise<unknown>) => {
    setPending(true);
    setFileError(undefined);
    try {
      if ((await work()) === false)
        throw new Error('Could not save this change. Please try again.');
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : 'Could not save this change. Please try again.',
      );
    } finally {
      setPending(false);
    }
  };
  const upload = (file?: File) => {
    if (!file || pending) return;
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      setFileError('Choose a PDF, Word (.docx), TXT, or Markdown file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError('Choose a file smaller than 5 MB.');
      return;
    }
    setFileError(undefined);
    void act(() => workspace.uploadDocument(file));
  };
  return (
    <section className="memory-panel" aria-label="Memory and profile">
      <div className="memory-panel__header">
        <div>
          <h2>Memory & profile</h2>
          <p>Details and references Nudge can use across your chats. Saved on this computer.</p>
        </div>
        <button
          type="button"
          className="icon-button icon-button--quiet"
          aria-label="Close memory"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="memory-tabs" role="tablist" aria-label="Memory sections">
        {(
          [
            { id: 'profile', label: 'Profile', Icon: UserRound },
            { id: 'documents', label: 'Documents', Icon: FileText },
            { id: 'settings', label: 'Settings', Icon: Settings2 },
          ] as const
        ).map(({ id, label, Icon }, index, tabs) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`memory-tab-${id}`}
            aria-controls={`memory-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : undefined;
              if (next !== undefined) {
                event.preventDefault();
                setTab(tabs[next]!.id);
                document.getElementById(`memory-tab-${tabs[next]!.id}`)?.focus();
              }
            }}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {fileError ? (
        <p role="alert" className="provider-error">
          {fileError}
        </p>
      ) : null}
      {tab === 'profile' ? (
        <div role="tabpanel" id="memory-panel-profile" aria-labelledby="memory-tab-profile">
          <h3>About you</h3>
          <p className="memory-panel__help">
            Nudge can remember details you share. Review, correct, or remove them here.
          </p>
          <ul className="memory-list">
            {workspace.facts.map((fact) => (
              <li key={fact.key}>
                <div>
                  <strong>{fact.key.replaceAll('_', ' ')}</strong>
                  <p>{fact.value}</p>
                  <small>
                    {fact.source === 'user' ? 'Added by you' : 'Remembered from a conversation'}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-button icon-button--quiet"
                  aria-label={`Edit ${fact.key}`}
                  onClick={() => {
                    setKey(fact.key);
                    setValue(fact.value);
                  }}
                >
                  <Pencil size={15} />
                </button>
                <ConfirmDelete
                  title="Delete this saved detail?"
                  description="This removes it from your profile. The original conversation is kept in chat history."
                  onConfirm={() => void act(() => workspace.deleteFact(fact.key))}
                >
                  <button
                    type="button"
                    className="icon-button icon-button--quiet"
                    aria-label={`Delete saved fact ${fact.key}`}
                    disabled={pending}
                  >
                    <Trash2 size={15} />
                  </button>
                </ConfirmDelete>
              </li>
            ))}
          </ul>
          <form
            className="memory-form"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                return workspace.saveFact(key.trim(), value.trim());
              });
            }}
          >
            <label>
              Detail name
              <input
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="Preferred name, role, location…"
                maxLength={100}
              />
            </label>
            <label>
              What should Nudge remember?
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
                rows={2}
                maxLength={2000}
              />
            </label>
            <button type="submit" disabled={pending || !key.trim() || !value.trim()}>
              <Plus size={15} /> Save detail
            </button>
          </form>
          {chatGpt ? <ChatGptPanel {...chatGpt} /> : null}
        </div>
      ) : null}
      {tab === 'documents' ? (
        <div role="tabpanel" id="memory-panel-documents" aria-labelledby="memory-tab-documents">
          <h3>Reference documents</h3>
          <p className="memory-panel__help">
            Add a CV, acceptance letter, or other reference so you can ask about it later.
          </p>
          <ul className="memory-list">
            {workspace.documents.map((doc) => (
              <li key={doc.id}>
                <FileText size={18} />
                <div>
                  <strong>{doc.filename}</strong>
                  <details>
                    <summary>View saved text</summary>
                    <pre>{doc.text}</pre>
                  </details>
                </div>
                <ConfirmDelete
                  title="Delete this reference?"
                  description="Nudge will no longer use this saved document as a reference."
                  onConfirm={() => void act(() => workspace.deleteDocument(doc.id))}
                >
                  <button
                    type="button"
                    className="icon-button icon-button--quiet"
                    disabled={pending}
                    aria-label={`Delete document ${doc.filename}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </ConfirmDelete>
              </li>
            ))}
          </ul>
          <div
            className="memory-dropzone"
            data-dragging={dragging}
            aria-label="Document upload area"
            aria-busy={pending}
            onDragOver={(event) => {
              event.preventDefault();
              if (!pending) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length > 1) {
                setFileError('Upload one document at a time.');
                return;
              }
              upload(event.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={34} aria-hidden="true" />
            <strong>
              {pending
                ? 'Saving your document…'
                : dragging
                  ? 'Drop your document here'
                  : 'Bring your context with you'}
            </strong>
            <p>Drop a CV, letter, or reference here. Text is extracted on this computer.</p>
            <div className="memory-file-types" aria-label="Accepted file types">
              {['PDF', 'DOCX', 'TXT', 'MD'].map((type) => (
                <span key={type}>{type}</span>
              ))}
            </div>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              aria-label="Upload PDF, Word, or text"
              accept=".pdf,.docx,.txt,.md"
              disabled={pending}
              onChange={(event) => {
                upload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button type="button" disabled={pending} onClick={() => fileInput.current?.click()}>
              Choose a file
            </button>
            <small>Up to 5 MB · text-based PDFs up to 30 pages</small>
          </div>

          <details className="memory-paste">
            <summary>Or paste reference text</summary>
            <form
              className="memory-form"
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  return workspace.saveDocument(filename.trim(), text.trim());
                });
              }}
            >
              <label>
                Document name
                <input
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  maxLength={200}
                />
              </label>
              <label>
                Reference text
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={5}
                  maxLength={100000}
                />
              </label>
              <button type="submit" disabled={pending || !text.trim() || !filename.trim()}>
                Save reference
              </button>
            </form>
          </details>
        </div>
      ) : null}
      {tab === 'settings' ? (
        <div role="tabpanel" id="memory-panel-settings" aria-labelledby="memory-tab-settings">
          <MemorySettings workspace={workspace} />
        </div>
      ) : null}
    </section>
  );
}
