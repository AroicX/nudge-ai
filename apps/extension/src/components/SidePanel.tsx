import type {
  ControllerSnapshot,
  ScheduledTask,
  ActionResult,
  ConversationTurn,
  PersistedTurn,
  SourceReference,
  VoiceSessionState,
  TimelineStep,
  ProviderSelection,
} from '@nudge/contracts';
import {
  ArrowDown,
  Check,
  Copy,
  Maximize2,
  Moon,
  Phone,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react';
import { Fragment, useRef, useState } from 'react';

import { useSharedTheme } from '../panel/use-shared-theme';
import { useFollowLatest } from '../panel/use-follow-latest';
import { ScheduledTasks } from './ScheduledTasks';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';
import { ChatSidebar } from './ChatSidebar';
import { MemoryPanel } from './MemoryPanel';
import { ChatModelSelector } from './ChatModelSelector';
import { Composer } from './Composer';
import { ProviderSettings, type ProviderHealth } from './ProviderSettings';
import { Status } from './Status';
import { LiveTranscript } from './LiveTranscript';
import { ExecutionTimeline } from './ExecutionTimeline';
import { CapabilityPrompt } from './CapabilityPrompt';
import { PreviewCard } from './PreviewCard';
import { ReportCard } from './ReportCard';

export interface ProviderFallbackRequest {
  reason: string;
}

interface SidePanelProps {
  memoryWorkspace?: MemoryWorkspace;
  allowTaskUpdates?: boolean;
  fullPage?: boolean;
  linkedPage?: SourceReference | undefined;
  onExpand?: () => void;
  providerPending?: boolean;
  providerError?: string | undefined;
  busy: boolean;
  scheduledTasks?: ScheduledTask[];
  onCancelSchedule?: (id: string) => void;
  onManageSchedule?: (
    id: string,
    action: 'run' | 'delete' | 'update',
    changes?: { instruction?: string; runAt?: number },
  ) => void;
  status?: string;
  conversation?: Array<
    ConversationTurn & Partial<Pick<PersistedTurn, 'sources' | 'provider' | 'model' | 'progress'>>
  >;
  actions?: ActionResult[];
  onSend(text: string): void;
  onStop(): void;
  onSaveKey(key: string): void;
  onClearKey(): void;
  onClearHistory?: () => void;
  voiceState?: VoiceSessionState;
  voiceTranscript?: string;
  liveVoiceTurn?: { role: 'user' | 'assistant'; text: string } | undefined;
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
  controller?: ControllerSnapshot | undefined;
  onConfirm?: (previewId: string, approved: boolean) => void;
  onContinue?: () => void;
  capabilityReason?: string | undefined;
  onRetryCapability?: () => void;
  onDismissCapability?: () => void;
  exports?: Array<{ filename: string; url: string }>;
  onExport?: (format: 'csv' | 'xlsx') => void;
  onSelectTab?: (number: number) => void;
}

export function SidePanel({
  busy,
  memoryWorkspace,
  allowTaskUpdates = true,
  fullPage = false,
  linkedPage,
  onExpand,
  providerPending = false,
  providerError,
  scheduledTasks = [],
  onCancelSchedule = () => undefined,
  onManageSchedule,
  status = 'Ready',
  conversation = [],
  onSend,
  onStop,
  onSaveKey,
  onClearKey,
  onClearHistory,
  voiceState = 'idle',
  voiceTranscript = '',
  liveVoiceTurn,
  voiceMuted = false,
  onMuteVoice = () => undefined,
  onInterruptVoice = () => undefined,
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
  controller,
  onConfirm = () => undefined,
  onContinue = () => undefined,
  capabilityReason,
  onRetryCapability = () => undefined,
  onDismissCapability = () => undefined,
  exports = [],
  onExport,
  onSelectTab = () => undefined,
}: SidePanelProps) {
  const fallback = controller?.fallbackOffer ?? fallbackRequest;
  const [memoryOpen, setMemoryOpen] = useState(false);
  const appearance = useSharedTheme();
  const conversationRef = useRef<HTMLElement>(null);
  const latest = useFollowLatest(conversationRef, !memoryOpen);
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
  const taskActive =
    busy ||
    !['idle', 'ended', 'failed'].includes(voiceState) ||
    Boolean(
      controller &&
      !['idle', 'completed', 'partially_completed', 'failed', 'cancelled'].includes(
        controller.status,
      ),
    );
  return (
    <div className={fullPage && memoryWorkspace ? 'chat-layout' : undefined}>
      {fullPage && memoryWorkspace ? (
        <ChatSidebar
          workspace={memoryWorkspace}
          busy={taskActive}
          onNavigate={() => setMemoryOpen(false)}
          onMemory={() => {
            setMemoryOpen(true);
            void memoryWorkspace.refreshMemory().catch(() => undefined);
          }}
        />
      ) : null}
      <main
        className={`panel${fullPage ? ' panel--fullpage' : ''}${!conversation.length && !liveVoiceTurn?.text ? ' panel--empty' : ''}${memoryOpen ? ' panel--memory' : ''}`}
      >
        <header>
          <img className="mark" src="/icons/nudge-128.png" alt="" />
          <div>
            <h1>Nudge</h1>
            <p>Your browser copilot</p>
          </div>
          <div className="header__actions">
            <button
              type="button"
              className="icon-button icon-button--quiet"
              aria-label={`Switch to ${appearance.theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={appearance.toggle}
            >
              {appearance.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {fullPage && showRealtimeVoice ? (
              <button
                type="button"
                className="icon-button icon-button--quiet"
                aria-label="Start voice call"
                disabled={!['idle', 'ended', 'failed'].includes(voiceState)}
                onClick={onStartVoice}
              >
                <Phone size={19} />
              </button>
            ) : null}
            {!fullPage && onExpand ? (
              <button
                type="button"
                className="icon-button icon-button--quiet"
                aria-label="Open full-page chat"
                onClick={onExpand}
              >
                <Maximize2 size={18} />
              </button>
            ) : null}
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
        {fullPage ? (
          <p className="page-context">
            {linkedPage ? `Working with ${linkedPage.domain}` : 'No browser page attached'}{' '}
          </p>
        ) : null}
        {!fullPage || busy || !/^(Ready|Using (?:OpenAI|local Ollama))/.test(status) ? (
          <Status value={status} />
        ) : null}
        {appearance.error ? (
          <p role="alert" className="provider-error">
            {appearance.error}
          </p>
        ) : null}
        {!liveVoiceTurn ? <LiveTranscript text={voiceTranscript} /> : null}
        {memoryWorkspace?.error ? (
          <p className="workspace-error" role="alert">
            {memoryWorkspace.error}
          </p>
        ) : null}
        {memoryOpen && memoryWorkspace ? (
          <MemoryPanel workspace={memoryWorkspace} onClose={() => setMemoryOpen(false)} />
        ) : null}
        {controller?.pendingPreview ? (
          <PreviewCard preview={controller.pendingPreview} onConfirm={onConfirm} />
        ) : null}
        {controller?.status === 'paused' ? (
          <section className="task-card task-card--paused" aria-label="Paused task">
            <p>{controller.memorySummary.issues.at(-1) ?? 'Nudge paused this task.'}</p>
            <div className="task-card__actions">
              <button type="button" onClick={onContinue}>
                Continue
              </button>
              <button type="button" className="secondary" onClick={onStop}>
                Stop
              </button>
            </div>
          </section>
        ) : null}
        {capabilityReason ? (
          <CapabilityPrompt
            reason={capabilityReason}
            onRetry={onRetryCapability}
            onDismiss={onDismissCapability}
          />
        ) : null}
        {controller?.report ? <ReportCard report={controller.report} /> : null}
        {(controller?.records ?? 0) > 0 && onExport ? (
          <section className="task-card task-card--exports" aria-label="Collected records">
            <p>{controller!.records} records collected.</p>
            <div className="task-card__actions">
              <button type="button" className="secondary" onClick={() => onExport('csv')}>
                Download CSV
              </button>
              <button type="button" className="secondary" onClick={() => onExport('xlsx')}>
                Download XLSX
              </button>
            </div>
            {exports.map((file) => (
              <a key={file.url} href={file.url} download={file.filename}>
                {file.filename}
              </a>
            ))}
          </section>
        ) : null}
        {fallback ? (
          <section className="fallback-request" aria-label="Provider approval">
            <p>{fallback.reason}</p>
            <div>
              <button type="button" onClick={onApproveFallback}>
                Use OpenAI for this task
              </button>
              <button type="button" className="secondary" onClick={onDeclineFallback}>
                Stop
              </button>
            </div>
          </section>
        ) : null}
        {controller?.tabChoices?.length ? (
          <section className="tab-picker" aria-label="Open browser tabs">
            <p className="tab-picker__title">Choose a tab</p>
            <div className="tab-picker__grid">
              {controller.tabChoices.map((tab) => (
                <button
                  type="button"
                  className="tab-choice"
                  key={`${tab.number}:${tab.tabId}`}
                  aria-label={`Tab ${tab.number}: ${tab.title}`}
                  onClick={() => onSelectTab(tab.number)}
                >
                  <strong>{tab.number}</strong>
                  <span className="tab-choice__text">
                    <span className="tab-choice__domain">
                      {tab.favIconUrl ? <img src={tab.favIconUrl} alt="" /> : null}
                      {tab.domain}
                    </span>
                    <small>{tab.title}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {fullPage ? (
          <ScheduledTasks
            jobs={scheduledTasks}
            onCancel={onCancelSchedule}
            onManage={onManageSchedule}
            activeTaskId={
              controller &&
              !['idle', 'completed', 'partially_completed', 'failed', 'cancelled'].includes(
                controller.status,
              )
                ? controller.taskId
                : undefined
            }
          />
        ) : null}
        <section ref={conversationRef} className="conversation" aria-label="Conversation">
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
                {turn.progress ? (
                  <ExecutionTimeline
                    showTimings={fullPage}
                    historical={
                      turn.progress.taskId !== controller?.taskId ||
                      !controller ||
                      ['idle', 'completed', 'failed', 'cancelled', 'partially_completed'].includes(
                        controller.status,
                      )
                    }
                    steps={turn.progress.steps}
                    status={turn.progress.status}
                    startedAt={turn.progress.startedAt}
                    completedAt={turn.progress.completedAt}
                  />
                ) : index === latestUserTurnIndex && !conversation.some((item) => item.progress) ? (
                  <ExecutionTimeline
                    showTimings={fullPage}
                    steps={timeline}
                    status={controller?.status}
                    startedAt={controller?.startedAt}
                    completedAt={controller?.completedAt}
                  />
                ) : null}
              </Fragment>
            ))
          ) : liveVoiceTurn?.text ? null : (
            <>
              <div className="empty">
                {fullPage ? <h2>What's on your mind?</h2> : null}
                <p>Ask Nudge to find, compare, filter, or navigate.</p>
              </div>
              <ExecutionTimeline
                showTimings={fullPage}
                steps={timeline}
                status={controller?.status}
                startedAt={controller?.startedAt}
                completedAt={controller?.completedAt}
              />
            </>
          )}
          {liveVoiceTurn?.text ? (
            <article
              className={`message message--${liveVoiceTurn.role} live-voice-turn`}
              aria-label={
                liveVoiceTurn.role === 'assistant' ? 'Live voice reply' : 'Live dictation'
              }
            >
              <div className={`turn turn--${liveVoiceTurn.role}`}>{liveVoiceTurn.text}</div>
              <span>{liveVoiceTurn.role === 'assistant' ? 'Speaking…' : 'Listening…'}</span>
            </article>
          ) : null}
        </section>
        <div className="composer-dock">
          {latest.showJump && !memoryOpen ? (
            <button className="jump-latest" type="button" onClick={latest.jump}>
              <ArrowDown size={15} /> Jump to latest
            </button>
          ) : null}
          <Composer
            allowUpdates={allowTaskUpdates}
            fullPage={fullPage}
            modelSelector={
              fullPage ? (
                <ChatModelSelector
                  selection={providerSelection}
                  health={providerHealth}
                  disabled={busy || providerPending}
                  onSelection={onProviderSelection}
                  onRefresh={onRefreshProviders}
                />
              ) : undefined
            }
            busy={busy}
            voiceState={voiceState}
            voiceMuted={voiceMuted}
            onMuteVoice={onMuteVoice}
            onInterruptVoice={onInterruptVoice}
            draft={draft}
            showRealtimeVoice={showRealtimeVoice}
            dictating={dictating}
            onSend={(text) => {
              latest.jump();
              onSend(text);
            }}
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
          {fullPage && providerError ? (
            <p className="provider-error" role="alert">
              {providerError}
            </p>
          ) : null}
          {fullPage ? (
            <p className="composer-hint">Nudge works in your browser. You stay in control.</p>
          ) : null}
        </div>
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
    </div>
  );
}
