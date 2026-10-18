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
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { Fragment, useRef, useState } from 'react';

import { useSharedTheme } from '../panel/use-shared-theme';
import { useFollowLatest } from '../panel/use-follow-latest';
import { ScheduledTasks } from './ScheduledTasks';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';
import { ChatSidebar } from './ChatSidebar';
import { AccountSettings } from './AccountSettings';
import { Toaster } from './nexus-ui/toaster';
import {
  Suggestion,
  SuggestionList,
  SuggestionPanel,
  SuggestionPanelClose,
  SuggestionPanelContent,
  SuggestionPanelHeader,
  SuggestionPanelTitle,
  Suggestions,
} from './nexus-ui/suggestions';
import { Image, ImageLightbox, ImageLightboxClose, ImageLightboxOverlay, ImageLightboxPreview, ImagePreview } from './nexus-ui/image';
import {
  FeedbackBar,
  FeedbackBarAction,
  FeedbackBarActions,
  FeedbackBarClose,
  FeedbackBarContent,
  FeedbackBarLabel,
  FeedbackBarPrompt,
} from './nexus-ui/feedback-bar';
import {
  Question,
  QuestionOption,
  QuestionOptions,
  QuestionOther,
  Questions,
  QuestionsHeader,
  QuestionsTitle,
} from './nexus-ui/questions';
import { ChatModelSelector } from './ChatModelSelector';
import { type ChatGptPanelProps } from './ChatGptPanel';
import { Composer } from './Composer';
import type { PendingImage } from '../chat/image-attachments';
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
  /** Chat image attachments (optional; omitted where images are not supported). */
  images?: PendingImage[];
  imageError?: string | undefined;
  onAddImages?: (files: File[]) => void;
  onRemoveImage?: (id: string) => void;
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
  planModels?: Array<{ slug: string; displayName: string }> | undefined;
  chatGpt?: ChatGptPanelProps | undefined;
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
  images,
  imageError,
  onAddImages,
  onRemoveImage,
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
  planModels,
  chatGpt,
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
  const [desk, setDesk] = useState<'account' | 'settings' | null>(null);
  const [suggestionGroup, setSuggestionGroup] = useState<keyof typeof SUGGESTION_GROUPS>();
  const memoryOpen = desk !== null;
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
    <div className={fullPage && memoryWorkspace ? `chat-layout${desk ? ' chat-layout--desk' : ''}` : undefined}>
      {fullPage && memoryWorkspace && !desk ? (
        <ChatSidebar
          workspace={memoryWorkspace}
          busy={taskActive}
          onNavigate={() => setDesk(null)}
          onMemory={() => {
            setDesk('account');
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
              onClick={() => {
                if (fullPage && memoryWorkspace) setDesk('settings');
                else setSettingsOpen(true);
              }}
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
        {!fullPage || busy || !/^(Ready|Using (?:OpenAI|local Ollama|ChatGPT plan))/.test(status) ? (
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
        {desk && fullPage && memoryWorkspace ? (
          <AccountSettings
            entry={desk}
            workspace={memoryWorkspace}
            appearance={appearance}
            providerSelection={providerSelection}
            providerHealth={providerHealth}
            chatGpt={chatGpt}
            onClose={() => setDesk(null)}
            onSaveKey={onSaveKey}
            onClearKey={onClearKey}
            onProviderSelection={onProviderSelection}
            onRefreshProviders={onRefreshProviders}
            onClearHistory={() => void onClearHistory?.()}
          />
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
        {fullPage && fallback ? (
          <Questions
            items={[
              {
                id: 'billing',
                type: 'single',
                required: true,
                prompt: fallback.reason,
                options: [
                  { value: 'openai', label: 'Use OpenAI for this task' },
                  { value: 'stop', label: 'Stop' },
                ],
              },
            ]}
            onSubmit={(submission) => {
              const answer = submission[0]?.answer;
              if (!answer || Array.isArray(answer)) return;
              if (answer.value === 'openai') onApproveFallback();
              else onDeclineFallback();
            }}
          >
            <QuestionsHeader>
              <QuestionsTitle />
            </QuestionsHeader>
            <Question id="billing">
              <QuestionOptions>
                <QuestionOption value="openai">Use OpenAI for this task</QuestionOption>
                <QuestionOption value="stop">Stop</QuestionOption>
              </QuestionOptions>
            </Question>
          </Questions>
        ) : fallback ? (
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
        {fullPage && controller?.pendingQuestion && !controller.tabChoices?.length && !fallback ? (
          <Questions
            items={[{ id: 'clarify', type: 'single', prompt: controller.pendingQuestion, options: [] }]}
            onSubmit={(submission) => {
              const answer = submission[0]?.answer;
              if (!answer || Array.isArray(answer) || !answer.value) return;
              onSend(String(answer.label));
            }}
          >
            <QuestionsHeader>
              <QuestionsTitle />
            </QuestionsHeader>
            <Question id="clarify">
              <QuestionOptions>
                <QuestionOther placeholder="Your answer" />
              </QuestionOptions>
            </Question>
          </Questions>
        ) : null}
        {fullPage && controller?.tabChoices?.length ? (
          <Questions
            items={[
              {
                id: 'tab',
                type: 'single',
                required: true,
                prompt: controller.pendingQuestion ?? 'Which tab should I use?',
                options: controller.tabChoices.map((tab) => ({
                  value: String(tab.number),
                  label: tab.title,
                })),
              },
            ]}
            onSubmit={(submission) => {
              const answer = submission[0]?.answer;
              if (!answer || Array.isArray(answer)) return;
              onSelectTab(Number(answer.value));
            }}
          >
            <QuestionsHeader>
              <QuestionsTitle />
            </QuestionsHeader>
            <Question id="tab">
              <QuestionOptions>
                {controller.tabChoices.map((tab) => (
                  <QuestionOption key={tab.tabId} value={String(tab.number)}>
                    {`${tab.number}. ${tab.domain} — ${tab.title}`}
                  </QuestionOption>
                ))}
              </QuestionOptions>
            </Question>
          </Questions>
        ) : controller?.tabChoices?.length ? (
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
                  {turn.images?.length ? (
                    <div className="turn-images" aria-label="Attached images">
                      {turn.images.map((image, imageIndex) => (
                        <img key={`${turn.id}:${imageIndex}`} src={image.thumbnail} alt={image.name} />
                      ))}
                    </div>
                  ) : null}
                  {turn.sources?.length ? (
                    <div className="source-chips">
                      {turn.sources.map((source) => (
                        <div className="source-chip" key={`${source.tabId}:${source.url}`}>
                          {fullPage && source.favIconUrl ? (
                            <Image src={source.favIconUrl} alt={source.title}>
                              <ImagePreview />
                              <ImageLightbox>
                                <ImageLightboxOverlay />
                                <ImageLightboxPreview alt={source.title} />
                                <ImageLightboxClose />
                              </ImageLightbox>
                            </Image>
                          ) : source.favIconUrl ? (
                            <img src={source.favIconUrl} alt="" />
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Open ${source.title} on ${source.domain}`}
                            onClick={() => onOpenSource(source)}
                          >
                            <span>{source.domain}</span>
                            <small>{source.title}</small>
                          </button>
                        </div>
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
                  {fullPage && turn.role === 'assistant' ? <ReplyFeedback id={turn.id} /> : null}
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
                {fullPage ? (
                  <Suggestions
                    onSelect={(value) => {
                      if (value in SUGGESTION_GROUPS) {
                        setSuggestionGroup(value as keyof typeof SUGGESTION_GROUPS);
                        return;
                      }
                      setDraft(value);
                      setSuggestionGroup(undefined);
                    }}
                  >
                    <SuggestionList>
                      <Suggestion highlight="page">Summarize the page I'm on</Suggestion>
                      <Suggestion highlight="options">Compare the options on this site</Suggestion>
                      <Suggestion highlight="cheapest">Find the cheapest matching result</Suggestion>
                      {(Object.keys(SUGGESTION_GROUPS) as Array<keyof typeof SUGGESTION_GROUPS>).map((group) => (
                        <Suggestion key={group} variant="outline" value={group}>
                          {group}
                        </Suggestion>
                      ))}
                    </SuggestionList>
                    {suggestionGroup ? (
                      <SuggestionPanel
                        open
                        onOpenChange={(open) => {
                          if (!open) setSuggestionGroup(undefined);
                        }}
                      >
                        <SuggestionPanelHeader>
                          <SuggestionPanelTitle>{suggestionGroup}</SuggestionPanelTitle>
                          <SuggestionPanelClose />
                        </SuggestionPanelHeader>
                        <SuggestionPanelContent>
                          <SuggestionList orientation="vertical">
                            {SUGGESTION_GROUPS[suggestionGroup].map((prompt) => (
                              <Suggestion key={prompt} variant="ghost">
                                {prompt}
                              </Suggestion>
                            ))}
                          </SuggestionList>
                        </SuggestionPanelContent>
                      </SuggestionPanel>
                    ) : null}
                  </Suggestions>
                ) : null}
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
                  planModels={planModels}
                  planAccountId={
                    providerSelection.provider === 'chatgpt' ? providerSelection.accountId : chatGpt?.activeAccountId
                  }
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
            images={images ?? []}
            imageError={imageError}
            {...(onAddImages ? { onAddImages } : {})}
            {...(onRemoveImage ? { onRemoveImage } : {})}
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
          {fullPage && providerSelection.provider === 'chatgpt' ? (
            <p className="composer-hint">{`Voice calls and dictation still use separately billed OpenAI API requests. They do not use your ChatGPT plan.`}</p>
          ) : null}
          {fullPage && providerError ? (
            <p className="provider-error" role="alert">
              {providerError}
            </p>
          ) : null}
          {fullPage ? (
            <p className="composer-hint">Nudge works in your browser. You stay in control.</p>
          ) : null}
        </div>
        {fullPage ? <Toaster theme={appearance.theme} /> : null}
        <ProviderSettings
          fullPage={fullPage}
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

const SUGGESTION_GROUPS = {
  Browse: ['Open the pricing page', 'List the headings on this page'],
  Compare: ['Compare the plans on this page', 'Which option is the least expensive?'],
  Remember: ['What do you remember about me?', 'Save that I prefer short answers'],
} as const;

function ReplyFeedback({ id }: { id: string }) {
  const [vote, setVote] = useState<'up' | 'down'>();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <FeedbackBar data-feedback={id}>
      <FeedbackBarContent>
        <FeedbackBarPrompt>
          <FeedbackBarLabel>{vote ? 'Thanks. This stays on this screen.' : 'Was this response helpful?'}</FeedbackBarLabel>
        </FeedbackBarPrompt>
        <FeedbackBarActions>
          <FeedbackBarAction asChild>
            <button type="button" aria-label="Helpful" aria-pressed={vote === 'up'} onClick={() => setVote('up')}>
              <ThumbsUp size={14} />
            </button>
          </FeedbackBarAction>
          <FeedbackBarAction asChild>
            <button type="button" aria-label="Not helpful" aria-pressed={vote === 'down'} onClick={() => setVote('down')}>
              <ThumbsDown size={14} />
            </button>
          </FeedbackBarAction>
        </FeedbackBarActions>
      </FeedbackBarContent>
      <FeedbackBarClose>
        <button type="button" aria-label="Dismiss feedback" onClick={() => setHidden(true)}>
          Close
        </button>
      </FeedbackBarClose>
    </FeedbackBar>
  );
}
