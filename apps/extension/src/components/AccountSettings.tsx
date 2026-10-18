import type { ProviderSelection } from '@nudge/contracts';
import {
  AudioLines,
  Cpu,
  Database,
  FileText,
  Gauge,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { MemoryClient, type MemoryDocument } from '../api/memory-client';
import { CHATGPT_VOICE_NOTE } from '../chatgpt/text-route';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';
import type { NudgeTheme } from '../panel/use-shared-theme';
import { ChatGptPanel, type ChatGptPanelProps } from './ChatGptPanel';
import { ConfirmDelete } from './ConfirmDelete';
import { toast } from './nexus-ui/toaster';
import { ProviderSettings, type ProviderHealth } from './ProviderSettings';
import { Modal } from './ui/modal';
import '../styles/settings-desk.css';

const memoryClient = new MemoryClient(
  import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
  import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
);

const PROFILE_FIELDS = [
  { key: 'preferred_name', label: 'Preferred name', help: 'What Nudge should call you' },
  { key: 'role', label: 'Role', help: 'Work, study, or what you are doing' },
  { key: 'location', label: 'Location', help: 'City, region, or timezone' },
  { key: 'about', label: 'About you', help: 'Context that should follow you across chats' },
] as const;

type SectionId = 'profile' | 'documents' | 'chatgpt' | 'usage' | 'general' | 'voice' | 'data' | 'models';

const NAV: Array<{
  id: SectionId;
  group: 'Account' | 'Settings';
  label: string;
  keywords: string;
  Icon: typeof UserRound;
  chatGpt?: boolean;
}> = [
  { id: 'profile', group: 'Account', label: 'Profile', keywords: 'name role memory facts about', Icon: UserRound },
  { id: 'documents', group: 'Account', label: 'Documents', keywords: 'files references upload cv letter', Icon: FileText },
  { id: 'chatgpt', group: 'Account', label: 'ChatGPT', keywords: 'plan connect subscription allowance', Icon: Sparkles, chatGpt: true },
  { id: 'usage', group: 'Account', label: 'Usage', keywords: 'billing voice api allowance', Icon: Gauge },
  { id: 'general', group: 'Settings', label: 'General', keywords: 'theme appearance remember diagnostics', Icon: Settings2 },
  { id: 'voice', group: 'Settings', label: 'Voice', keywords: 'dictation speech calls realtime', Icon: AudioLines },
  { id: 'data', group: 'Settings', label: 'Data', keywords: 'delete chats cleanup storage privacy', Icon: Database },
  { id: 'models', group: 'Settings', label: 'Models', keywords: 'openai ollama api key provider', Icon: Cpu },
];

export function AccountSettings({
  entry,
  workspace,
  appearance,
  providerSelection,
  providerHealth,
  chatGpt,
  onClose,
  onSaveKey,
  onClearKey,
  onProviderSelection,
  onRefreshProviders,
  onClearHistory,
}: {
  entry: 'account' | 'settings';
  workspace: MemoryWorkspace;
  appearance: { theme: NudgeTheme; toggle(): void };
  providerSelection: ProviderSelection;
  providerHealth?: ProviderHealth | undefined;
  chatGpt?: ChatGptPanelProps | undefined;
  onClose(): void;
  onSaveKey(key: string): void;
  onClearKey(): void;
  onProviderSelection(value: ProviderSelection): void;
  onRefreshProviders(): void;
  onClearHistory(): void;
}) {
  const [section, setSection] = useState<SectionId>(entry === 'account' ? 'profile' : 'general');
  const [query, setQuery] = useState('');
  const [preferences, setPreferences] = useState<{ autoRemember: boolean; localDiagnostics: boolean }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [days, setDays] = useState(90);
  const [draft, setDraft] = useState<{ key: string; value: string; originalKey?: string }>();
  const [docQuery, setDocQuery] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [paste, setPaste] = useState<{ filename: string; text: string }>();
  const [viewing, setViewing] = useState<{ filename: string; text: string }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    setSection(entry === 'account' ? 'profile' : 'general');
  }, [entry]);
  useEffect(() => {
    void memoryClient
      .preferences()
      .then(setPreferences)
      .catch(() => setError('Connect to the updated local Nudge server to change memory settings.'));
  }, []);
  const notice = (message: string) => {
    setError(message);
    toast.error(message);
  };
  const act = async (work: () => Promise<unknown>, success: string) => {
    setPending(true);
    setError('');
    try {
      if ((await work()) === false) throw new Error('Could not save this change. Please try again.');
      toast.success(success);
      return true;
    } catch (cause) {
      notice(cause instanceof Error ? cause.message : 'Could not save this change. Please try again.');
      return false;
    } finally {
      setPending(false);
    }
  };
  const savePreference = async (value: NonNullable<typeof preferences>) => {
    setPending(true);
    setError('');
    try {
      setPreferences(await memoryClient.savePreferences(value));
      toast.success('Setting saved on this computer');
    } catch {
      notice('Could not save the setting. Your previous choice remains active.');
    } finally {
      setPending(false);
    }
  };
  const upload = (file?: File) => {
    if (!file || pending) return;
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      notice('Choose a PDF, Word (.docx), TXT, or Markdown file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notice('Choose a file smaller than 5 MB.');
      return;
    }
    void act(() => workspace.uploadDocument(file), `Saved ${file.name}`);
  };
  const items = NAV.filter((item) => !item.chatGpt || chatGpt).filter((item) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(needle);
  });
  const current = NAV.find((item) => item.id === section) ?? NAV[0]!;
  const known = new Set<string>(PROFILE_FIELDS.map((field) => field.key));
  const extras = workspace.facts.filter((fact) => !known.has(fact.key));
  const oldChats = workspace.chats.filter(
    (chat) => chat.id !== workspace.activeId && Date.parse(chat.updatedAt) < Date.now() - days * 86400000,
  );
  return (
    <div className="account-settings">
      <aside className="settings-nav" aria-label="Account and settings">
        <label className="settings-search">
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search settings"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <nav
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? index + 1 : index - 1;
            const button = buttons[(next + buttons.length) % buttons.length];
            button?.focus();
            const id = button?.dataset.section;
            if (id) setSection(id as SectionId);
          }}
        >
          {(['Account', 'Settings'] as const).map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (!groupItems.length) return null;
            return (
              <div key={group} className="settings-group">
                <p>{group}</p>
                {groupItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-section={item.id}
                    aria-current={section === item.id ? 'page' : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <item.Icon size={16} aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            );
          })}
          {!items.length ? <p className="settings-empty">No matching settings.</p> : null}
        </nav>
      </aside>
      <section className="settings-main" aria-labelledby="settings-section-title">
        <header>
          <div>
            <h2 id="settings-section-title">{current.label}</h2>
            <p>{sectionCopy(section, providerSelection)}</p>
          </div>
          <button type="button" className="icon-button icon-button--quiet" aria-label={entry === 'account' ? 'Close account' : 'Close settings'} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {error ? (
          <p role="alert" className="provider-error">
            {error}
          </p>
        ) : null}
        {section === 'profile' ? (
          <div className="settings-stack">
            <div className="settings-card">
              {PROFILE_FIELDS.map((field) => {
                const fact = workspace.facts.find((item) => item.key === field.key);
                return (
                  <ProfileEditor
                    key={`${field.key}:${fact?.value ?? ''}`}
                    label={field.label}
                    help={field.help}
                    saved={fact?.value ?? ''}
                    multiline={field.key === 'about'}
                    pending={pending}
                    onSave={(value) => {
                      if (!value) {
                        if (fact) void act(() => workspace.deleteFact(field.key), 'Removed from your profile');
                        return;
                      }
                      void act(() => workspace.saveFact(field.key, value), 'Saved to your profile');
                    }}
                  />
                );
              })}
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <strong>Other remembered details</strong>
                  <p>Nudge can use these across chats. They stay on this computer.</p>
                </div>
                <button type="button" onClick={() => setDraft({ key: '', value: '' })}>
                  <Plus size={15} /> Add detail
                </button>
              </div>
              {extras.map((fact) => (
                <div key={fact.key} className="settings-row">
                  <div>
                    <strong>{fact.key.replaceAll('_', ' ')}</strong>
                    <p>{fact.value}</p>
                    <small>{fact.source === 'user' ? 'Added by you' : 'Remembered from a conversation'}</small>
                  </div>
                  <div className="settings-row__actions">
                    <button type="button" className="secondary" aria-label={`Edit ${fact.key}`} onClick={() => setDraft({ key: fact.key, value: fact.value, originalKey: fact.key })}>
                      Edit
                    </button>
                    <ConfirmDelete
                      title="Delete this saved detail?"
                      description="This removes it from your profile. The original conversation is kept in chat history."
                      onConfirm={() => void act(() => workspace.deleteFact(fact.key), 'Removed from your profile')}
                    >
                      <button type="button" className="icon-button icon-button--quiet" aria-label={`Delete saved fact ${fact.key}`} disabled={pending}>
                        <Trash2 size={15} />
                      </button>
                    </ConfirmDelete>
                  </div>
                </div>
              ))}
              {!extras.length ? (
                <p className="settings-note">No extra details yet.</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {section === 'documents' ? (
          <DocumentsLibrary
            documents={workspace.documents}
            query={docQuery}
            onQuery={setDocQuery}
            selected={selectedDocs}
            onSelected={setSelectedDocs}
            pending={pending}
            dragging={dragging}
            fileInput={fileInput}
            onDragOver={(event) => {
              event.preventDefault();
              if (!pending) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length > 1) {
                notice('Upload one document at a time.');
                return;
              }
              upload(event.dataTransfer.files[0]);
            }}
            onChoose={() => fileInput.current?.click()}
            onFile={(file) => {
              upload(file);
              if (fileInput.current) fileInput.current.value = '';
            }}
            onPaste={() => setPaste({ filename: 'My reference', text: '' })}
            onView={(doc) => setViewing({ filename: doc.filename, text: doc.text })}
            onDelete={(ids) =>
              void act(async () => {
                for (const id of ids) {
                  if ((await workspace.deleteDocument(id)) === false) return false;
                }
                setSelectedDocs((current) => current.filter((id) => !ids.includes(id)));
                return true;
              }, ids.length === 1 ? 'Reference removed' : 'References removed')
            }
          />
        ) : null}
        {section === 'chatgpt' && chatGpt ? (
          <div className="settings-stack">
            <ChatGptPanel {...chatGpt} />
            <details className="settings-card settings-setup">
              <summary>Set up the local companion</summary>
              <p>On macOS, from the Nudge project folder:</p>
              <pre>
                <code>{`pnpm --filter @nudge/chatgpt-host install-host -- --extension-id ${/^[a-p]{32}$/.test(globalThis.location?.hostname ?? '') ? globalThis.location.hostname : 'YOUR_EXTENSION_ID'}`}</code>
              </pre>
              <p>Reload the extension, then choose Continue with ChatGPT. Credentials stay on this computer.</p>
            </details>
          </div>
        ) : null}
        {section === 'usage' ? (
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <strong>Text</strong>
                <p>{textBilling(providerSelection)}</p>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <strong>Voice and dictation</strong>
                <p>{voiceBilling(providerSelection)}</p>
              </div>
            </div>
            {providerSelection.provider === 'chatgpt' && chatGpt?.connected ? (
              <div className="settings-row">
                <div>
                  <strong>Plan allowance</strong>
                  <p>Nudge only shows a limit when ChatGPT reports one. Remaining quota is in ChatGPT settings.</p>
                </div>
                <button type="button" className="secondary" onClick={chatGpt.onManageUsage}>
                  Manage usage
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {section === 'general' ? (
          <div className="settings-card">
            <Switch
              label="Dark theme"
              description="Applies to full-screen chat and the side panel on this browser."
              checked={appearance.theme === 'dark'}
              onChange={appearance.toggle}
            />
            <Switch
              label="Automatically remember useful details"
              description="Save clear personal details from new messages. Turning this off keeps existing saved details and chat history."
              checked={preferences?.autoRemember ?? false}
              disabled={!preferences || pending}
              onChange={(checked) => void savePreference({ ...preferences!, autoRemember: checked })}
            />
            <Switch
              label="Local performance diagnostics"
              description="Log model timing and token counts to the local server console. No chat text or external analytics."
              checked={preferences?.localDiagnostics ?? false}
              disabled={!preferences || pending}
              onChange={(checked) => void savePreference({ ...preferences!, localDiagnostics: checked })}
            />
          </div>
        ) : null}
        {section === 'voice' ? (
          <div className="settings-card">
            <div className="settings-row">
              <div>
                <strong>How voice is processed</strong>
                <p>{voiceBilling(providerSelection)}</p>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <strong>One conversation at a time</strong>
                <p>A voice call uses the same reply path as typed chat. Stopping the call does not delete the transcript already on screen.</p>
              </div>
            </div>
          </div>
        ) : null}
        {section === 'data' ? (
          <div className="settings-stack">
            <div className="settings-stats">
              <span>
                <strong>{workspace.chats.length}</strong> chats
              </span>
              <span>
                <strong>{workspace.facts.length}</strong> details
              </span>
              <span>
                <strong>{workspace.documents.length}</strong> documents
              </span>
            </div>
            <div className="settings-card">
              <div className="settings-row settings-row--stack">
                <div>
                  <strong>Clean up older chats</strong>
                  <p>The current chat and uploaded documents stay. Review the list before deleting. This cannot be undone.</p>
                </div>
                <label>
                  Last updated more than
                  <select aria-label="Cleanup age" value={days} onChange={(event) => setDays(Number(event.target.value))}>
                    <option value={30}>30 days ago</option>
                    <option value={90}>90 days ago</option>
                    <option value={365}>1 year ago</option>
                  </select>
                </label>
                <p>
                  {oldChats.length} {oldChats.length === 1 ? 'chat matches' : 'chats match'} this period.
                </p>
                {oldChats.length ? (
                  <ul className="settings-match-list">
                    {oldChats.map((chat) => (
                      <li key={chat.id}>{chat.title}</li>
                    ))}
                  </ul>
                ) : null}
                <ConfirmDelete
                  title={`Delete ${oldChats.length} older chats?`}
                  description="This removes those conversations, their cached copies, and profile details derived from them. This cannot be undone."
                  onConfirm={() => {
                    void (async () => {
                      setPending(true);
                      try {
                        for (const chat of oldChats) {
                          if ((await workspace.deleteChat(chat.id, Date.now() - days * 86400000)) === false)
                            throw new Error('Deletion failed');
                        }
                        toast.success(oldChats.length ? 'Older chats deleted' : 'Nothing to delete');
                      } catch {
                        notice('Cleanup stopped because a chat could not be deleted. Review the remaining chats and try again.');
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
              </div>
            </div>
          </div>
        ) : null}
        {section === 'models' ? (
          <ProviderSettings
            embedded
            open
            selection={providerSelection}
            health={providerHealth}
            onSelection={onProviderSelection}
            onRefresh={onRefreshProviders}
            onSave={(key) => {
              onSaveKey(key);
              toast.success('OpenAI API key saved for this session');
            }}
            onClear={() => {
              onClearKey();
              toast.info('Using the local default provider');
            }}
            onClearHistory={onClearHistory}
            onClose={() => undefined}
          />
        ) : null}
      </section>
      <Modal
        open={Boolean(draft)}
        title={draft?.originalKey ? 'Edit detail' : 'Add a detail'}
        description="Nudge stores this on this computer and can use it in later chats."
        onOpenChange={(open) => {
          if (!open) setDraft(undefined);
        }}
      >
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft?.key.trim() || !draft.value.trim()) return;
            const nextKey = draft.key.trim();
            const nextValue = draft.value.trim();
            const previous = draft.originalKey;
            void act(async () => {
              if ((await workspace.saveFact(nextKey, nextValue)) === false) return false;
              if (previous && previous !== nextKey) {
                if ((await workspace.deleteFact(previous)) === false) return false;
              }
              return true;
            }, 'Saved to your profile').then((ok) => {
              if (ok) setDraft(undefined);
            });
          }}
        >
          <label>
            Detail name
            <input
              aria-label="Detail name"
              value={draft?.key ?? ''}
              maxLength={100}
              onChange={(event) => setDraft((current) => (current ? { ...current, key: event.target.value } : current))}
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <label>
            What should Nudge remember?
            <textarea
              aria-label="What should Nudge remember?"
              value={draft?.value ?? ''}
              rows={4}
              maxLength={2000}
              onChange={(event) => setDraft((current) => (current ? { ...current, value: event.target.value } : current))}
            />
          </label>
          <div className="settings-form__actions">
            <button type="button" className="secondary" onClick={() => setDraft(undefined)}>
              Cancel
            </button>
            <button type="submit" disabled={pending || !draft?.key.trim() || !draft.value.trim()}>
              Save detail
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(paste)}
        title="Paste reference text"
        description="The text is stored on this computer and can be used as context in later chats."
        onOpenChange={(open) => {
          if (!open) setPaste(undefined);
        }}
      >
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!paste?.filename.trim() || !paste.text.trim()) return;
            void act(
              async () => workspace.saveDocument(paste.filename.trim(), paste.text.trim()),
              'Reference saved',
            ).then((ok) => {
              if (ok) setPaste(undefined);
            });
          }}
        >
          <label>
            Document name
            <input aria-label="Document name" value={paste?.filename ?? ''} maxLength={200} onChange={(event) => setPaste((current) => (current ? { ...current, filename: event.target.value } : current))} />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <label>
            Reference text
            <textarea aria-label="Reference text" value={paste?.text ?? ''} rows={6} maxLength={100000} onChange={(event) => setPaste((current) => (current ? { ...current, text: event.target.value } : current))} />
          </label>
          <div className="settings-form__actions">
            <button type="button" className="secondary" onClick={() => setPaste(undefined)}>
              Cancel
            </button>
            <button type="submit" disabled={pending || !paste?.filename.trim() || !paste.text.trim()}>
              Save reference
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(viewing)}
        title={viewing?.filename ?? 'Reference'}
        description="Saved text extracted on this computer."
        onOpenChange={(open) => {
          if (!open) setViewing(undefined);
        }}
      >
        <pre className="settings-document">{viewing?.text}</pre>
        <div className="settings-form__actions">
          <button type="button" className="secondary" onClick={() => setViewing(undefined)}>
            Close
          </button>
        </div>
      </Modal>
    </div>
  );
}

function ProfileEditor({
  label,
  help,
  saved,
  multiline,
  pending,
  onSave,
}: {
  label: string;
  help: string;
  saved: string;
  multiline?: boolean;
  pending: boolean;
  onSave(value: string): void;
}) {
  const [text, setText] = useState(saved);
  const dirty = text.trim() !== saved.trim();
  return (
    <div className="settings-row settings-row--stack">
      <label>
        <strong>{label}</strong>
        <p>{help}</p>
        {multiline ? (
          <textarea aria-label={label} value={text} rows={3} maxLength={2000} onChange={(event) => setText(event.target.value)} />
        ) : (
          <input aria-label={label} value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} />
        )}
      </label>
      {dirty ? (
        <button type="button" disabled={pending || (!text.trim() && !saved)} onClick={() => onSave(text.trim())}>
          Save
        </button>
      ) : null}
    </div>
  );
}

function DocumentsLibrary({
  documents,
  query,
  onQuery,
  selected,
  onSelected,
  pending,
  dragging,
  fileInput,
  onDragOver,
  onDragLeave,
  onDrop,
  onChoose,
  onFile,
  onPaste,
  onView,
  onDelete,
}: {
  documents: MemoryDocument[];
  query: string;
  onQuery(value: string): void;
  selected: string[];
  onSelected(ids: string[]): void;
  pending: boolean;
  dragging: boolean;
  fileInput: RefObject<HTMLInputElement | null>;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDragLeave(event: DragEvent<HTMLDivElement>): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
  onChoose(): void;
  onFile(file?: File): void;
  onPaste(): void;
  onView(doc: MemoryDocument): void;
  onDelete(ids: string[]): void;
}) {
  const visible = documents.filter((doc) =>
    doc.filename.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selectedVisible = visible.filter((doc) => selected.includes(doc.id));
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  return (
    <div className="settings-stack">
      <label className="doc-search">
        <Search size={15} aria-hidden="true" />
        <input
          aria-label="Search documents"
          placeholder="Search documents"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <div
        className="doc-drop"
        data-dragging={dragging}
        aria-label="Document upload area"
        aria-busy={pending}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className="doc-drop__icon" aria-hidden="true">
          <UploadCloud size={28} />
        </span>
        <strong>{pending ? 'Saving your document…' : dragging ? 'Drop your document here' : 'Bring your context with you'}</strong>
        <p>Drop a CV, letter, or reference. Text is extracted on this computer.</p>
        <div className="doc-types" aria-hidden="true">
          {['PDF', 'DOCX', 'TXT', 'MD'].map((type) => (
            <span key={type} data-type={type.toLowerCase()}>
              {type}
            </span>
          ))}
        </div>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          aria-label="Upload PDF, Word, or text"
          accept=".pdf,.docx,.txt,.md"
          disabled={pending}
          onChange={(event) => onFile(event.target.files?.[0])}
        />
        <div className="settings-row__actions">
          <button type="button" disabled={pending} onClick={onChoose}>
            Choose a file
          </button>
          <button type="button" className="secondary" disabled={pending} onClick={onPaste}>
            Paste text
          </button>
        </div>
        <small>PDF, DOCX, TXT, or MD · up to 5 MB</small>
      </div>
      {documents.length ? (
        <div className="doc-toolbar">
          <label>
            <input
              type="checkbox"
              aria-label="Select all documents"
              checked={allSelected}
              disabled={!visible.length || pending}
              onChange={() => onSelected(allSelected ? selected.filter((id) => !visible.some((doc) => doc.id === id)) : [...new Set([...selected, ...visible.map((doc) => doc.id)])])}
            />
            {visible.length} {visible.length === 1 ? 'file' : 'files'}
          </label>
          {selectedVisible.length ? (
            <ConfirmDelete
              title={`Delete ${selectedVisible.length} ${selectedVisible.length === 1 ? 'document' : 'documents'}?`}
              description="Nudge will no longer use the selected files as references."
              onConfirm={() => onDelete(selectedVisible.map((doc) => doc.id))}
            >
              <button type="button" className="secondary" disabled={pending}>
                <Trash2 size={15} /> Delete selected
              </button>
            </ConfirmDelete>
          ) : null}
        </div>
      ) : null}
      {visible.length ? (
        <ul className="doc-grid">
          {visible.map((doc) => {
            const kind = fileKind(doc.filename);
            return (
              <li key={doc.id} className="doc-card" data-selected={selected.includes(doc.id)}>
                <label className="doc-card__check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${doc.filename}`}
                    checked={selected.includes(doc.id)}
                    disabled={pending}
                    onChange={() =>
                      onSelected(
                        selected.includes(doc.id) ? selected.filter((id) => id !== doc.id) : [...selected, doc.id],
                      )
                    }
                  />
                </label>
                <button type="button" className="doc-card__open" onClick={() => onView(doc)} aria-label={`View ${doc.filename}`}>
                  <span className={`doc-badge doc-badge--${kind}`} aria-hidden="true">
                    <FileText size={22} />
                    {kind.toUpperCase()}
                  </span>
                  <strong>{doc.filename}</strong>
                  <small>{doc.text.length.toLocaleString()} characters</small>
                </button>
                <ConfirmDelete
                  title="Delete this reference?"
                  description="Nudge will no longer use this saved document as a reference."
                  onConfirm={() => onDelete([doc.id])}
                >
                  <button type="button" className="doc-card__delete" aria-label={`Delete document ${doc.filename}`} disabled={pending}>
                    <Trash2 size={15} />
                  </button>
                </ConfirmDelete>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="settings-note">{query.trim() ? 'No documents match that search.' : 'No reference documents yet.'}</p>
      )}
    </div>
  );
}

function fileKind(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf' || ext === 'docx' || ext === 'doc' || ext === 'txt' || ext === 'md') return ext === 'doc' ? 'docx' : ext;
  return 'file';
}

function switchId(label: string) {
  return `switch-${label.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
}

function Switch({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="settings-row">
      <div>
        <strong id={switchId(label)}>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        className="settings-switch"
        aria-checked={checked}
        aria-labelledby={switchId(label)}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function sectionCopy(section: SectionId, selection: ProviderSelection): ReactNode {
  if (section === 'profile') return 'Details Nudge can use across chats. Saved on this computer. Connecting ChatGPT does not import its history or memory.';
  if (section === 'documents') return 'Reference files stay local. Nudge reads the extracted text when a chat needs it.';
  if (section === 'chatgpt') return 'Eligible full-screen text can use your ChatGPT plan. API mode stays a separate choice.';
  if (section === 'usage') return textBilling(selection);
  if (section === 'general') return 'Appearance and what Nudge is allowed to remember.';
  if (section === 'voice') return voiceBilling(selection);
  if (section === 'data') return 'Chats, profile details, and documents are stored by the local Nudge server.';
  return 'OpenAI API billing is separate from a ChatGPT plan. Choosing a plan model does not spend API credit.';
}

function textBilling(selection: ProviderSelection) {
  if (selection.provider === 'chatgpt') return 'Eligible text uses your connected ChatGPT plan allowance.';
  if (selection.provider === 'ollama') return 'Text runs on local Ollama.';
  return 'Text uses the OpenAI API and is billed separately.';
}

function voiceBilling(selection: ProviderSelection) {
  if (selection.provider === 'ollama') return 'Voice uses the local voice stack with Ollama. It does not use a ChatGPT plan token.';
  if (selection.provider === 'chatgpt') return CHATGPT_VOICE_NOTE;
  return 'Voice calls and dictation use separately billed OpenAI API requests.';
}
