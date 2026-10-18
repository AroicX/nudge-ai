import { ConfirmDelete } from './ConfirmDelete';
import { useState } from 'react';
import { Brain, Home, Search, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';

export function ChatSidebar({
  workspace,
  busy,
  onMemory,
  onNavigate,
}: {
  workspace: MemoryWorkspace;
  busy: boolean;
  onMemory(): void;
  onNavigate?(): void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const chats = workspace.chats.filter((chat) =>
    chat.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <aside className="chat-sidebar" aria-label="Saved chats">
      <div className="chat-sidebar__brand">
        <img className="mark" src="/icons/nudge-128.png" alt="" />
        <strong>Nudge</strong>
      </div>
      <button
        type="button"
        className="chat-sidebar__new"
        disabled={busy || workspace.loading}
        onClick={() => {
          onNavigate?.();
          void workspace.newChat();
        }}
      >
        <Plus size={17} /> New chat
      </button>
      <button
        type="button"
        className="chat-sidebar__link"
        aria-expanded={searching}
        onClick={() => setSearching(!searching)}
      >
        <Search size={17} /> Search chats
      </button>
      {searching ? (
        <input
          className="chat-sidebar__search"
          aria-label="Search saved chats"
          placeholder="Search saved chats…"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <button
        type="button"
        className="chat-sidebar__link"
        onClick={() => {
          setQuery('');
          setSearching(false);
          onNavigate?.();
        }}
      >
        <Home size={17} /> Home
      </button>
      <p className="chat-sidebar__section">Recent</p>
      <nav aria-label="Conversations">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`chat-sidebar__row${workspace.activeId === chat.id ? ' is-selected' : ''}`}
          >
            <button
              type="button"
              aria-current={workspace.activeId === chat.id ? 'page' : undefined}
              disabled={busy || workspace.loading}
              onClick={() => {
                onNavigate?.();
                void workspace.selectChat(chat.id);
              }}
            >
              <MessageSquare size={15} />
              <span>{chat.title}</span>
            </button>
            <ConfirmDelete
              title="Delete this chat?"
              description="This removes its saved messages from this computer. Saved profile details and documents stay available."
              onConfirm={() => void workspace.deleteChat(chat.id)}
            >
              <button
                type="button"
                aria-label={`Delete chat ${chat.title}`}
                disabled={busy || workspace.loading}
                className="chat-sidebar__delete"
              >
                <Trash2 size={14} />
              </button>
            </ConfirmDelete>
          </div>
        ))}
        {!chats.length ? (
          <p className="chat-sidebar__note">
            {query ? 'No matching chats.' : 'Your chats will appear here.'}
          </p>
        ) : null}
      </nav>
      {busy ? (
        <p className="chat-sidebar__note">
          Finish or stop the current task before switching chats.
        </p>
      ) : null}
      <button type="button" className="chat-sidebar__memory" onClick={onMemory}>
        <Brain size={17} /> Memory & profile
      </button>
      <p className="chat-sidebar__note">Saved on this computer</p>
    </aside>
  );
}
