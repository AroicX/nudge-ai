import type { ActionResult, ConversationTurn, VoiceSessionState } from '@nudge/contracts';
import { Check, Copy, Settings } from 'lucide-react';
import { useState } from 'react';

import { Composer } from './Composer';
import { ProviderSettings } from './ProviderSettings';
import { Status } from './Status';
import { LiveTranscript } from './LiveTranscript';

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
  voiceState?: VoiceSessionState;
  voiceTranscript?: string;
  voiceMuted?: boolean;
  onStartVoice?: () => void;
  onEndVoice?: () => void;
  onMuteVoice?: () => void;
  onInterruptVoice?: () => void;
  onPushToTalk?: () => void;
}

export function SidePanel({
  busy,
  status = 'Ready',
  conversation = [],
  onSend,
  onStop,
  onSaveKey,
  onClearKey,
  voiceState = 'idle',
  voiceTranscript = '',
  voiceMuted = false,
  onStartVoice = () => undefined,
  onEndVoice = () => undefined,
  onMuteVoice = () => undefined,
}: SidePanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string>();
  const copyMessage = async (turn: ConversationTurn) => {
    await navigator.clipboard.writeText(turn.text);
    setCopiedId(turn.id);
    window.setTimeout(() => setCopiedId(undefined), 1200);
  };
  return (
    <main className="panel">
      <header>
        <span className="mark">N</span>
        <div>
          <h1>Nudge</h1>
          <p>Your browser copilot</p>
        </div>
        <button
          type="button"
          className="icon-button icon-button--quiet header__settings"
          aria-label="Open settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={19} />
        </button>
      </header>
      <Status value={status} />
      <LiveTranscript text={voiceTranscript} />
      <section className="conversation" aria-label="Conversation">
        {conversation.length ? (
          conversation.map((turn) => (
            <article className={`message message--${turn.role}`} key={turn.id}>
              <p className={`turn turn--${turn.role}`}>{turn.text}</p>
              <button
                type="button"
                className="copy-button"
                aria-label="Copy message"
                onClick={() => void copyMessage(turn)}
              >
                {copiedId === turn.id ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </article>
          ))
        ) : (
          <p className="empty">Ask Nudge to find, compare, filter, or navigate.</p>
        )}
      </section>
      <Composer
        busy={busy}
        voiceState={voiceState}
        voiceMuted={voiceMuted}
        onSend={onSend}
        onStop={onStop}
        onStartVoice={onStartVoice}
        onEndVoice={onEndVoice}
        onMuteVoice={onMuteVoice}
      />
      <ProviderSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={onSaveKey}
        onClear={onClearKey}
      />
    </main>
  );
}
