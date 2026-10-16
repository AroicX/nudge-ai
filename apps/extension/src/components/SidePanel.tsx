import type {
  ActionResult,
  ConversationTurn,
  PersistedTurn,
  SourceReference,
  VoiceSessionState,
  TimelineStep,
  ProviderSelection,
} from '@nudge/contracts';
import { Check, Copy, Settings, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';

import { Composer } from './Composer';
import { ProviderSettings, type ProviderHealth } from './ProviderSettings';
import { Status } from './Status';
import { LiveTranscript } from './LiveTranscript';
import { ExecutionTimeline } from './ExecutionTimeline';
import type { ProviderFallbackRequest } from '../orchestration/provider-fallback';

interface SidePanelProps {
  busy: boolean;
  status?: string;
  conversation?: Array<
    ConversationTurn & Partial<Pick<PersistedTurn, 'sources' | 'provider' | 'model'>>
  >;
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
  onDictate?: () => Promise<string | undefined>;
  showRealtimeVoice?: boolean;
  onOpenSource?: (source: SourceReference) => void;
  timeline?: TimelineStep[];
  providerSelection?: ProviderSelection;
  providerHealth?: ProviderHealth | undefined;
  onProviderSelection?: (value: ProviderSelection) => void;
  onRefreshProviders?: () => void;
  fallbackRequest?: ProviderFallbackRequest | undefined;
  onApproveFallback?: () => void;
  onDeclineFallback?: () => void;
}

export function SidePanel({
  busy,
  status = 'Ready',
  conversation = [],
  onSend,
  onStop,
  onSaveKey,
  onClearKey,
  onClearHistory,
  voiceState = 'idle',
  voiceTranscript = '',
  onStartVoice = () => undefined,
  onEndVoice = () => undefined,
  onDictate = async () => '',
  showRealtimeVoice = true,
  onOpenSource = () => undefined,
  timeline = [],
  providerSelection = { provider: 'openai' },
  providerHealth,
  onProviderSelection = () => undefined,
  onRefreshProviders = () => undefined,
  fallbackRequest,
  onApproveFallback = () => undefined,
  onDeclineFallback = () => undefined,
}: SidePanelProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [dictating, setDictating] = useState(false);
  const latestUserTurnIndex = conversation.findLastIndex((turn) => turn.role === 'user');
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
        <div className="header__actions">
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label="Clear chat"
            disabled={busy || (!conversation.length && !timeline.length)}
            onClick={onClearHistory}
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--quiet"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={19} />
          </button>
        </div>
      </header>
      <Status value={status} />
      <LiveTranscript text={voiceTranscript} />
      {fallbackRequest ? (
        <section className="fallback-request" aria-label="Provider approval">
          <p>{fallbackRequest.reason}</p>
          <div>
            <button type="button" onClick={onApproveFallback}>Use OpenAI for this task</button>
            <button type="button" className="secondary" onClick={onDeclineFallback}>Stop</button>
          </div>
        </section>
      ) : null}
      <section className="conversation" aria-label="Conversation">
        {conversation.length ? (
          conversation.map((turn, index) => (
            <Fragment key={turn.id}>
              <article className={`message message--${turn.role}`}>
                <p className={`turn turn--${turn.role}`}>{turn.text}</p>
                {turn.sources?.length ? (
                  <div className="source-chips">
                    {turn.sources.map((source) => (
                      <button
                        type="button"
                        className="source-chip"
                        key={`${source.tabId}:${source.url}`}
                        aria-label={`Open ${source.title} on ${source.domain}`}
                        onClick={() => onOpenSource(source)}
                      >
                        {source.favIconUrl ? <img src={source.favIconUrl} alt="" /> : null}
                        <span>{source.domain}</span>
                        <small>{source.title}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="copy-button"
                  aria-label="Copy message"
                  onClick={() => void copyMessage(turn)}
                >
                  {copiedId === turn.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </article>
              {index === latestUserTurnIndex ? <ExecutionTimeline steps={timeline} /> : null}
            </Fragment>
          ))
        ) : (
          <>
            <p className="empty">Ask Nudge to find, compare, filter, or navigate.</p>
            <ExecutionTimeline steps={timeline} />
          </>
        )}
      </section>
      <Composer
        busy={busy}
        voiceState={voiceState}
        draft={draft}
        showRealtimeVoice={showRealtimeVoice}
        dictating={dictating}
        onSend={onSend}
        onDraftChange={setDraft}
        onDictate={() => {
          void onDictate()
            .then((text) => {
              if (text === undefined) {
                setDictating(true);
                return;
              }
              if (text) setDraft(text);
              setDictating(false);
            })
            .catch(() => setDictating(false));
        }}
        onStop={onStop}
        onStartVoice={onStartVoice}
        onEndVoice={onEndVoice}
      />
      <ProviderSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={onSaveKey}
        onClear={onClearKey}
        selection={providerSelection}
        health={providerHealth}
        onSelection={onProviderSelection}
        onRefresh={onRefreshProviders}
        onClearHistory={() => void onClearHistory?.()}
      />
    </main>
  );
}
