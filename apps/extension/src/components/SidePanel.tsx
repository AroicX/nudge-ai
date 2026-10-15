import type { ActionResult, ConversationTurn } from '@nudge/contracts';

import { ActionHistory } from './ActionHistory';
import { Composer } from './Composer';
import { ProviderSettings } from './ProviderSettings';
import { Status } from './Status';

interface SidePanelProps {
  busy: boolean;
  status?: string;
  conversation?: ConversationTurn[];
  actions?: ActionResult[];
  onSend(text: string): void;
  onStop(): void;
  onSaveKey(key: string): void;
  onClearKey(): void;
  onClearHistory?: () => void;
}

export function SidePanel({
  busy,
  status = 'Ready',
  conversation = [],
  actions = [],
  onSend,
  onStop,
  onSaveKey,
  onClearKey,
  onClearHistory,
}: SidePanelProps) {
  return (
    <main className="panel">
      <header>
        <span className="mark">N</span>
        <div>
          <h1>Nudge</h1>
          <p>Your browser copilot</p>
        </div>
      </header>
      <Status value={status} />
      <section className="conversation" aria-label="Conversation">
        {conversation.length ? (
          conversation.map((turn) => (
            <p className={`turn turn--${turn.role}`} key={turn.id}>
              {turn.text}
            </p>
          ))
        ) : (
          <p className="empty">Ask Nudge to find, compare, filter, or navigate.</p>
        )}
      </section>
      <ActionHistory actions={actions} onClear={onClearHistory} />
      <Composer busy={busy} onSend={onSend} onStop={onStop} />
      <ProviderSettings onSave={onSaveKey} onClear={onClearKey} />
    </main>
  );
}
