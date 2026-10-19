import {
  MUTATING_TOOLS,
  VISUAL_TOOLS,
  type CandidateProfile,
  type ToolResult,
  recordFieldsToObject,
  type AuthorizationRecord,
  type ContentResult,
  type ControllerMessage,
  type ControllerSnapshot,
  type Expectation,
  type FinalReport,
  type Observation,
  type OperationPreview,
  type PageSnapshot,
  type PlannerRequest,
  type PlannerResponse,
  type ScreenshotFrame,
  type TabReference,
  type TaskMemory,
  type TaskStatus,
  type TimelineStep,
  type ToolCall,
} from '@nudge/contracts';
import {
  ActionScheduler,
  DEFAULT_BUDGET,
  ProgressMonitor,
  classifyRisk,
  eventFingerprint,
  googleCalendarDayUrl,
  googleCalendarTemplateUrl,
  parseClock,
  resolveDate,
  resolveEventTiming,
  type EventTiming,
  directDestination,
  RecordStore,
  addConstraint,
  addIssue,
  addSource,
  appendStep,
  applyPlanUpdate,
  bindConfirmation,
  buildReport,
  checkExpectation,
  classifyInstruction,
  createMemory,
  evaluateToolCall,
  extendAuthorization,
  isTerminal,
  plannerView,
  restoreCheckpoint,
  sanitizeAuthorization,
  setTabRole,
  targetFingerprint,
  toCheckpoint,
  toCsv,
  toXlsx,
  transition,
  validateTimedRepeat,
  type Confirmation,
  type RiskTarget,
  type PolicyOutcome,
  type TaskEvent,
} from '@nudge/core';

import type {
  CdpPort,
  CheckpointPort,
  ContentPort,
  PlannerPort,
  ProfilePort,
  ScreenshotPort,
  TabsPort,
} from './ports';
import { isContinuationRequest } from '../panel/message-routing';
import { parseNativeBrowserCommand, type NativeBrowserCommand } from '../tabs/native-browser';

export interface OtpTransferPort {
  transfer(input: {
    taskId: string;
    generation: number;
    sourceTabId: number;
    service: string;
    destinationTabId: number;
    destinationElementId: string;
    destinationDocumentId: string;
  }): Promise<{ ok: boolean; detail: string }>;
  cancelAll(): void;
}

export interface ControllerDeps {
  tabs: TabsPort;
  content: ContentPort;
  planner: PlannerPort;
  screenshots: ScreenshotPort;
  cdp?: CdpPort | undefined;
  checkpoints: CheckpointPort;
  otp: OtpTransferPort;
  clock: () => number;
  emit(message: ControllerMessage): void;
  provider: () => 'openai' | 'ollama';
  subscriptionText?: () => boolean;
  subscriptionTools?: () => boolean;
  capabilities: () => { vision: boolean };
  /** Saved candidate profile and documents (local server). */
  profile?: ProfilePort | undefined;
  /** User's IANA timezone (settings or browser); used for relative dates. */
  timeZone?: () => string;
  id?: () => string;
  limits?: { maxCalls: number; maxMs: number };
  nativeBrowser?: (
    command: NativeBrowserCommand,
    originTabId: number | undefined,
    signal: AbortSignal,
  ) => Promise<string>;
}

interface Task {
  id: string;
  status: TaskStatus;
  instruction: string;
  memory: TaskMemory;
  authorization: AuthorizationRecord;
  records: RecordStore;
  boundTabId: number;
  boundTabClosed: boolean;
  tabs: TabReference[];
  snapshot?: PageSnapshot | undefined;
  snapshotFresh: boolean;
  frame?: ScreenshotFrame | undefined;
  wantScreenshot: boolean;
  pendingPreview?: OperationPreview | undefined;
  lastPreview?: OperationPreview | undefined;
  confirmation?: Confirmation | undefined;
  pendingQuestion?: string | undefined;
  tabChoices?: Array<TabReference & { number: number }> | undefined;
  sources: Map<string, TabReference>;
  fallbackOffer?: { reason: string } | undefined;
  useOpenAI: boolean;
  needsScope: boolean;
  provider?: 'openai' | 'ollama' | undefined;
  report?: FinalReport | undefined;
  cancellationRequested?: boolean;
  finishing?: { outcome: FinalReport['outcome'] };
  timeline: TimelineStep[];
  startedAt: number;
  completedAt?: number;
  rejectedFinishes: number;
  notes: string[];
  lastResult?: PlannerRequest['lastResult'];
  repeatNotes: number;
  policyBlockContext?: string | undefined;
  policyBlockCounts: Map<string, number>;
  timedRepeatId?: string | undefined;
  observedUrls: Set<string>;
  userTypedUrls: string[];
  skipped: Array<{ item: string; reason: string }>;
  exports: string[];
  capabilityLost: boolean;
  stepCount: number;
  unsubscribe: Array<() => void>;
  progress: ProgressMonitor;
  /** Consecutive attempts the controller refused because they had already made no progress. */
  refusedRepeats: number;
  calendar?: CalendarDraftState | undefined;
}

interface CalendarDraftState {
  title: string;
  timing: Extract<EventTiming, { ok: true }>;
  attendees: string[];
  fingerprint: string;
  saveAttempts: number;
  /** A save was attempted and its outcome is not yet confirmed by a lookup. */
  needsLookup: boolean;
  verified: boolean;
}

const GENERIC_EVENT_TITLES = new Set(['meeting', 'a meeting', 'event', 'new event', 'appointment', 'call', 'sync', 'untitled', '(no title)', 'calendar event']);
const TIME_IN_TEXT = /\b(?:\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|noon|midday|midnight)\b/gi;
const DURATION_IN_TEXT =
  /\b(?:for\s+)?(?:an?\s+|\d+(?:\.\d+)?\s*|half\s+an?\s+|one\s+|two\s+|three\s+)(?:hours?|hrs?|minutes?|mins?)\b|\b(?:until|till|to|-|–)\s*\d{1,2}(?::\d{2})?\s?(?:am|pm)?\b/i;

const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/g;

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

function selection(snapshot: PageSnapshot | undefined): string[] {
  return (snapshot?.elements ?? [])
    .filter((element) => element.kind === 'checkbox' && element.checked)
    .map((element) => element.name ?? element.label ?? element.id);
}

function describeCall(call: ToolCall, snapshot?: PageSnapshot): string {
  const target =
    'elementId' in call && call.elementId
      ? snapshot?.elements.find((element) => element.id === call.elementId)
      : undefined;
  const name = target?.name ?? target?.text;
  switch (call.tool) {
    case 'click':
      return `Click “${name ?? 'element'}”`;
    case 'double_click':
      return `Double-click “${name ?? 'element'}”`;
    case 'type_text':
      return `Type into “${name ?? 'field'}”`;
    case 'press_keys':
      return `Press ${call.keys.join(' ')}`;
    case 'select_option':
      return `Choose “${call.value}”`;
    case 'scroll':
      return `Scroll ${call.direction}`;
    case 'navigate':
    case 'open_tab':
      return `Open ${call.url}`;
    case 'activate_tab':
      return 'Switch tab';
    case 'click_at':
    case 'double_click_at':
      return `Click at (${Math.round(call.x)}, ${Math.round(call.y)})`;
    case 'drag_at':
      return 'Drag on the page';
    case 'type_at':
      return 'Type on the page';
    default:
      return call.tool.replace(/_/g, ' ');
  }
}

function fingerprintOf(call: ToolCall): string {
  return JSON.stringify(call);
}

export class TaskController {
  #task: Task | undefined;
  #scheduler = new ActionScheduler();
  #loop: Promise<void> | undefined;
  #again = false;
  #planAbort: AbortController | undefined;
  #capability: 'dom_only' | 'dom_plus_trusted_input' = 'dom_only';
  #recordsKey = 0;
  #starting: Promise<void> | undefined;

  constructor(private readonly deps: ControllerDeps) {}

  // ───────────────────────── public surface ─────────────────────────

  snapshot(): ControllerSnapshot {
    const task = this.#task;
    if (!task) {
      return {
        status: 'idle',
        plan: [],
        memorySummary: { recordCount: 0, issues: [] },
        capability: this.#capability,
        timeline: [],
      };
    }
    return {
      taskId: task.id,
      startedAt: task.startedAt,
      ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
      status: task.status,
      goal: task.memory.goal,
      plan: task.memory.plan,
      memorySummary: { recordCount: task.records.list().length, issues: task.memory.issues },
      ...(task.pendingPreview ? { pendingPreview: task.pendingPreview } : {}),
      ...(task.pendingQuestion ? { pendingQuestion: task.pendingQuestion } : {}),
      ...(task.tabChoices?.length ? { tabChoices: task.tabChoices } : {}),
      ...(task.sources.size ? { sources: [...task.sources.values()].slice(-100) } : {}),
      ...(task.report ? { report: task.report } : {}),
      ...(task.fallbackOffer ? { fallbackOffer: task.fallbackOffer } : {}),
      capability: this.#capability,
      authorization: task.authorization,
      timeline: task.timeline.slice(-100),
      records: task.records.list().length,
    };
  }

  async idle(): Promise<void> {
    while (this.#loop) await this.#loop;
  }

  async startScheduled(input: {
    id: string;
    instruction: string;
    originTabId: number;
    provider: 'openai' | 'ollama';
    prepare?: () => Promise<void>;
  }): Promise<'started' | 'busy'> {
    if (this.#starting || (this.#task && !isTerminal(this.#task.status))) return 'busy';
    await this.#start(input.instruction, input.originTabId, input);
    return 'started';
  }

  async instruct(text: string, source: 'text' | 'voice', originTabId?: number): Promise<void> {
    // Startup may be waiting on a model or native browser API. Do not queue Stop behind it.
    const startingTask = this.#task;
    if (this.#starting && startingTask && !isTerminal(startingTask.status)) {
      const early = classifyInstruction(text, {
        taskActive: true,
        confirmationPending: false,
        tabTitles: [],
      });
      if (
        early.kind === 'stop' ||
        (early.kind === 'pause' && parseNativeBrowserCommand(startingTask.instruction))
      ) {
        await this.#cancel(
          early.kind === 'stop'
            ? 'Stopped at your request.'
            : 'Browser control cancelled at your pause request. Already applied changes remain.',
        );
        return;
      }
    }
    if (this.#starting) await this.#starting;
    const task = this.#task;
    const active = task && !isTerminal(task.status);
    if (
      task?.status === 'cancelled' &&
      parseNativeBrowserCommand(task.instruction) &&
      classifyInstruction(text, { taskActive: true, confirmationPending: false, tabTitles: [] })
        .kind === 'resume'
    ) {
      this.deps.emit({
        type: 'milestone',
        text: 'That browser control was cancelled. Send the browser command again to retry.',
      });
      return;
    }
    if (active && parseNativeBrowserCommand(text)) {
      this.deps.emit({
        type: 'milestone',
        text: 'Stop or finish the current task before changing browser controls.',
      });
      return;
    }
    const classified = classifyInstruction(text, {
      taskActive: Boolean(active),
      confirmationPending: task?.status === 'waiting_for_confirmation',
      tabTitles: (task?.tabs ?? []).map((tab) => ({ tabId: tab.tabId, title: tab.title })),
    });
    if (!active || !task) {
      if (classified.kind === 'stop') return;
      await this.#start(text, originTabId);
      return;
    }
    if (isContinuationRequest(text) && task.status !== 'waiting_for_confirmation') {
      const note =
        'Continue on the current page from where you stopped. Use uploaded account documents and saved profile facts for form fields. Ask only for a field that is absent from those references.';
      if (task.status === 'paused') {
        task.notes.push(note);
        this.control('resume');
        return;
      }
      if (task.status === 'waiting_for_user' && !task.fallbackOffer) {
        this.answer(note);
        return;
      }
      this.#correct(note, source);
      return;
    }
    if (
      originTabId !== undefined &&
      /\b(?:(?:this|current) (?:page|tab)|page I(?:'m| am) (?:looking at|on))\b/i.test(text) &&
      ['correction', 'new_task', 'tab_correction'].includes(classified.kind)
    ) {
      await this.#tabCorrection(originTabId, undefined, text);
      return;
    }
    if (
      task.status === 'waiting_for_user' &&
      task.tabChoices?.length &&
      classified.kind === 'correction'
    ) {
      await this.#start(text, originTabId);
      return;
    }
    switch (classified.kind) {
      case 'stop':
        await this.#cancel('Stopped at your request.');
        return;
      case 'pause':
        this.control('pause');
        return;
      case 'resume':
        this.control('resume');
        return;
      case 'skip':
        this.#scheduler.bumpGeneration();
        task.memory = applyPlanUpdate(
          task.memory,
          task.memory.plan.map((item) =>
            item.status === 'active' ? { ...item, status: 'skipped' } : item,
          ),
        );
        task.notes.push(
          `User (${source}) asked to skip the current item; move on to the next one.`,
        );
        this.#resumeIfWaiting();
        return;
      case 'confirm':
        if (task.pendingPreview) this.confirm(task.pendingPreview.previewId, classified.approved);
        return;
      case 'tab_correction':
        await this.#tabCorrection(classified.tabId, classified.tabIndex, classified.text);
        return;
      case 'correction':
      case 'new_task':
        if (task.status === 'waiting_for_user' && !task.fallbackOffer) {
          this.answer(classified.text);
          return;
        }
        this.#correct(classified.text, source);
        return;
    }
  }

  control(action: 'stop' | 'pause' | 'resume' | 'continue_budget'): void {
    const task = this.#task;
    if (!task || isTerminal(task.status)) return;
    if (action === 'stop') {
      void this.#cancel('Stopped at your request.');
      return;
    }
    if (action === 'pause') {
      if (parseNativeBrowserCommand(task.instruction)) {
        void this.#cancel(
          'Browser control cancelled at your pause request. Already applied changes remain.',
        );
        return;
      }
      this.#scheduler.bumpGeneration();
      this.#planAbort?.abort();
      this.#set('pause');
      return;
    }
    if (action === 'continue_budget') this.#scheduler.resetBudget();
    if (task.status === 'paused') {
      task.snapshotFresh = false;
      this.#set('resume');
      this.#kick();
    }
  }

  confirm(previewId: string, approved: boolean): void {
    const task = this.#task;
    if (
      !task ||
      task.status !== 'waiting_for_confirmation' ||
      task.pendingPreview?.previewId !== previewId
    )
      return;
    const preview = task.pendingPreview;
    task.pendingPreview = undefined;
    if (approved) {
      task.confirmation = bindConfirmation(preview, this.#scheduler.generation);
      task.notes.push(
        `User confirmed: ${preview.operation} (${preview.count} items). Proceed with exactly that operation.`,
      );
      this.#set('confirmed');
    } else {
      task.confirmation = undefined;
      task.skipped.push({ item: preview.operation, reason: 'You declined the preview.' });
      task.notes.push(
        `User declined: ${preview.operation}. Do not perform it; continue or report what remains.`,
      );
      this.#set('declined');
    }
    task.snapshotFresh = false;
    this.#kick();
  }

  answer(text: string): void {
    const task = this.#task;
    if (!task || task.status !== 'waiting_for_user') return;
    task.pendingQuestion = undefined;
    task.tabChoices = undefined;
    task.memory = addConstraint(
      task.memory,
      `User answered: ${text}`,
      this.#scheduler.instructionVersion,
    );
    task.authorization = extendAuthorization(task.authorization, text);
    task.notes.push(`User answered: ${text}`);
    task.progress.reset();
    task.refusedRepeats = 0;
    task.snapshotFresh = false;
    if (task.boundTabClosed) {
      const match = task.tabs.find((tab) => text.toLowerCase().includes(tab.title.toLowerCase()));
      if (match) this.#rebind(match.tabId);
    }
    this.#set('answered');
    this.#kick();
  }

  approveFallback(approved: boolean): void {
    const task = this.#task;
    if (!task?.fallbackOffer) return;
    task.fallbackOffer = undefined;
    task.pendingQuestion = undefined;
    if (!approved) {
      void this.#finishTask(
        'failed',
        'OpenAI fallback was not approved, so the task stopped before acting.',
      );
      return;
    }
    task.useOpenAI = true;
    if (task.needsScope) {
      task.needsScope = false;
      task.status = 'planning';
      void this.#scopeTask(task);
      return;
    }
    this.#set('answered');
    this.#kick();
  }

  capabilityGranted(): void {
    this.#capability = 'dom_plus_trusted_input';
    const task = this.#task;
    if (task?.status === 'waiting_for_user' && task.capabilityLost) {
      task.capabilityLost = false;
      task.pendingQuestion = undefined;
      this.#set('answered');
      this.#kick();
    } else this.#broadcast();
  }

  async requestExport(format: 'csv' | 'xlsx'): Promise<void> {
    const task = this.#task;
    if (!task) return;
    this.#export(task, format);
  }

  /** Called by the background when a content script reports a timed repeat ended on its own. */
  timedEnded(repeatId: string, reason: string): void {
    const task = this.#task;
    if (!task || task.timedRepeatId !== repeatId) return;
    task.timedRepeatId = undefined;
    if (reason === 'stopped') return;
    void this.#finishTask('completed', `The repeated action ended: ${reason.replace('_', ' ')}.`);
  }

  async restore(): Promise<void> {
    const checkpoint = await this.deps.checkpoints.load();
    if (!checkpoint || isTerminal(checkpoint.status)) return;
    const restored = restoreCheckpoint(checkpoint);
    const records = RecordStore.from({
      fields: checkpoint.memory.recordFields,
      records: checkpoint.records,
    });
    this.#scheduler = new ActionScheduler(this.deps.clock);
    this.#task = this.#newTask({
      id: checkpoint.taskId,
      instruction: checkpoint.authorization.instruction,
      memory: restored.memory,
      authorization: checkpoint.authorization,
      records,
      boundTabId:
        checkpoint.boundTabId ??
        checkpoint.memory.tabs.find((tab) => tab.role === 'origin')?.tabId ??
        0,
      status: 'paused',
      provider: checkpoint.provider ?? this.deps.provider(),
    });
    this.#task.notes.push(
      'Nudge restarted. Re-check the page; do not repeat an action whose outcome is uncertain without verifying it first.',
    );
    this.#watchTabs(this.#task);
    await this.#checkpoint(this.#task);
    this.#broadcast();
  }

  // ───────────────────────── lifecycle ─────────────────────────

  #newTask(input: {
    id: string;
    instruction: string;
    memory: TaskMemory;
    authorization: AuthorizationRecord;
    records: RecordStore;
    boundTabId: number;
    status: TaskStatus;
    provider?: 'openai' | 'ollama' | undefined;
  }): Task {
    return {
      ...input,
      boundTabClosed: false,
      tabs: [],
      snapshotFresh: false,
      wantScreenshot: false,
      useOpenAI: false,
      needsScope: false,
      timeline: [],
      startedAt: this.deps.clock(),
      rejectedFinishes: 0,
      notes: [],
      repeatNotes: 0,
      policyBlockCounts: new Map(),
      observedUrls: new Set(),
      sources: new Map(),
      userTypedUrls: input.instruction.match(URL_IN_TEXT) ?? [],
      skipped: [],
      exports: [],
      capabilityLost: false,
      stepCount: 0,
      unsubscribe: [],
      progress: new ProgressMonitor(),
      refusedRepeats: 0,
    };
  }

  #start(
    instruction: string,
    originTabId?: number,
    scheduled?: { id: string; provider: 'openai' | 'ollama'; prepare?: () => Promise<void> },
  ): Promise<void> {
    // Reserve synchronously; preparation can change the backend's selected provider.
    const starting = Promise.resolve().then(async () => {
      await scheduled?.prepare?.();
      await this.#initialize(instruction, originTabId, scheduled);
    });
    this.#starting = starting;
    return starting.finally(() => {
      if (this.#starting === starting) this.#starting = undefined;
    });
  }

  async #initialize(
    instruction: string,
    originTabId?: number,
    scheduled?: { id: string; provider: 'openai' | 'ollama' },
  ): Promise<void> {
    if (this.#task) this.#teardown(this.#task);
    await this.idle();
    const id = scheduled?.id ?? this.deps.id?.() ?? `task_${crypto.randomUUID()}`;
    this.#scheduler = new ActionScheduler(this.deps.clock);
    const tabs = await this.deps.tabs.list();
    const origin = tabs.find((tab) => tab.tabId === originTabId);
    const placeholder: AuthorizationRecord = {
      taskId: id,
      instruction,
      origins: [],
      categories: ['read', 'navigate'],
      destinations: [],
      exclusions: [],
      limits: {},
    };
    const task = this.#newTask({
      id,
      instruction,
      memory: createMemory(instruction),
      authorization: placeholder,
      records: new RecordStore([]),
      boundTabId: origin?.tabId ?? 0,
      status: 'planning',
      provider: scheduled?.provider ?? this.deps.provider(),
    });
    task.tabs = tabs;
    this.#task = task;
    this.#watchTabs(task);
    this.#timeline(task, 'scope', 'Understanding your request', 'active');
    this.#broadcast();
    const nativeCommand = parseNativeBrowserCommand(instruction);
    if (nativeCommand) {
      const abort = new AbortController();
      this.#planAbort = abort;
      this.#timeline(task, 'scope', 'Understood the browser command', 'completed');
      this.#set('plan_ready');
      if (origin) task.sources.set(origin.url, origin);
      try {
        if (!this.deps.nativeBrowser)
          throw new Error('Browser controls are unavailable. Reload the extension and try again.');
        const result = await this.deps.nativeBrowser(nativeCommand, originTabId, abort.signal);
        if (abort.signal.aborted || this.#task !== task || isTerminal(task.status)) return;
        task.memory = appendStep(task.memory, {
          tool: 'native_browser',
          summary: result,
          ok: true,
          evidence: result,
        });
        await this.#finishTask('completed', result);
      } catch (error) {
        if (abort.signal.aborted || this.#task !== task || isTerminal(task.status)) return;
        await this.#finishTask(
          'failed',
          error instanceof Error ? error.message : 'The browser control did not finish.',
        );
      }
      return;
    }
    if (!origin && directDestination(instruction)) {
      await this.#openWithoutSource(task, directDestination(instruction)!);
      return;
    }
    if (!origin) {
      await this.#finishTask('failed', 'There is no ordinary web page open for Nudge to work in.');
      return;
    }
    if (this.#needsExplicitApi(task)) {
      task.needsScope = true;
      this.#offerPlanApproval(task);
      return;
    }
    await this.#scopeTask(task);
  }

  async #scopeTask(task: Task): Promise<void> {
    const origin = task.tabs.find((tab) => tab.tabId === task.boundTabId);
    if (!origin) {
      await this.#finishTask('failed', 'There is no ordinary web page open for Nudge to work in.');
      return;
    }
    task.memory = setTabRole(task.memory, origin, 'origin');
    const abort = new AbortController();
    this.#planAbort = abort;
    try {
      const scope = await this.deps.planner.scope(
        {
          requestId: crypto.randomUUID(),
          instruction: task.instruction,
          originTabId: origin.tabId,
          tabs: task.tabs.map(({ tabId, title, url }) => ({ tabId, title, url })),
        },
        abort.signal,
        this.#providerOverride(task),
      );
      if (abort.signal.aborted || this.#task !== task || isTerminal(task.status)) return;
      task.authorization = sanitizeAuthorization(scope.proposal, task.instruction, task.id);
      task.memory = { ...task.memory, goal: scope.goal, recordFields: scope.recordFields ?? [] };
      task.records = new RecordStore(scope.recordFields ?? []);
      this.#timeline(task, 'scope', 'Understood the request', 'completed');
      this.#set('plan_ready');
      await this.#checkpoint(task);
      this.#kick();
    } catch (error) {
      if (abort.signal.aborted || this.#task !== task || isTerminal(task.status)) return;
      if (this.#offerFallback(task, error)) return;
      await this.#finishTask(
        'failed',
        error instanceof Error ? error.message : 'Nudge could not understand the request.',
      );
    }
  }

  /** Exact destination requests need no readable source page. Verify with Chrome's live URL. */
  async #openWithoutSource(task: Task, destination: string): Promise<void> {
    task.authorization = sanitizeAuthorization(
      {
        origins: [new URL(destination).origin],
        categories: ['read', 'navigate'],
        destinations: [],
        exclusions: [],
        limits: {},
      },
      task.instruction,
      task.id,
    );
    this.#set('plan_ready');
    const call: ToolCall = { tool: 'open_tab', url: destination };
    const policy = this.#policy(task, call, { requestId: crypto.randomUUID(), toolCall: call });
    if (policy.decision !== 'allow') {
      await this.#finishTask(
        'failed',
        policy.decision === 'clarify' ? policy.question : policy.reason,
      );
      return;
    }
    try {
      const outcome = await this.#scheduler.run({ fingerprint: fingerprintOf(call) }, () =>
        this.#execute(task, call),
      );
      if (this.#task !== task || isTerminal(task.status) || outcome.status !== 'done') return;
      const opened = (await this.deps.tabs.list()).find((tab) => tab.tabId === task.boundTabId);
      if (!opened || opened.url !== destination) {
        await this.#finishTask(
          'failed',
          'The tab opened, but I could not verify the requested destination.',
        );
        return;
      }
      task.sources.set(opened.url, opened);
      task.memory = addSource(task.memory, opened.url);
      task.memory = appendStep(task.memory, {
        tool: 'open_tab',
        summary: `Opened ${opened.domain}`,
        ok: true,
        evidence: `Chrome reports ${opened.url}`,
      });
      this.#timeline(task, 'scope', 'Understood the request', 'completed');
      await this.#finishTask('completed', `${opened.domain} is open.`);
    } catch (error) {
      if (this.#task !== task || isTerminal(task.status)) return;
      await this.#finishTask(
        'failed',
        error instanceof Error ? error.message : 'Could not open the destination.',
      );
    }
  }

  #watchTabs(task: Task): void {
    task.unsubscribe.push(
      this.deps.tabs.onRemoved((tabId) => {
        if (this.#task !== task) return;
        task.tabs = task.tabs.filter((tab) => tab.tabId !== tabId);
        if (tabId === task.boundTabId) {
          task.boundTabClosed = true;
          this.#scheduler.bumpGeneration();
          if (task.timedRepeatId) {
            task.timedRepeatId = undefined;
            void this.#finishTask(
              'completed',
              'The tab was closed, so the repeated action stopped.',
            );
          }
        }
      }),
      this.deps.tabs.onUpdated((tabId, info) => {
        if (this.#task !== task || tabId !== task.boundTabId || !info.url || !task.timedRepeatId)
          return;
        try {
          const origin = new URL(info.url).origin;
          const original = task.memory.tabs.find((tab) => tab.tabId === tabId)?.origin;
          if (original && origin !== original) {
            void this.#stopTimed(task).then(() =>
              this.#finishTask(
                'completed',
                'The page navigated away, so the repeated action stopped.',
              ),
            );
          }
        } catch {
          /* ignore */
        }
      }),
    );
  }

  #teardown(task: Task): void {
    task.unsubscribe.forEach((unsubscribe) => unsubscribe());
    task.unsubscribe = [];
  }

  async #cancel(summary: string): Promise<void> {
    const task = this.#task;
    if (!task || isTerminal(task.status)) return;
    task.cancellationRequested = true;
    this.#scheduler.bumpGeneration();
    this.#planAbort?.abort();
    await this.#stopTimed(task);
    await this.#finishTask('cancelled', summary);
  }

  async #stopTimed(task: Task): Promise<void> {
    if (!task.timedRepeatId) return;
    const repeatId = task.timedRepeatId;
    task.timedRepeatId = undefined;
    await this.deps.content
      .send(task.boundTabId, { type: 'timed_stop', repeatId })
      .catch(() => undefined);
  }

  async #finishTask(outcome: FinalReport['outcome'], summary: string): Promise<void> {
    const task = this.#task;
    if (!task || isTerminal(task.status)) return;
    if ((task.cancellationRequested || task.finishing) && outcome !== 'cancelled') return;
    if (outcome === 'cancelled') task.cancellationRequested = true;
    // Cancellation can replace a pending success/failure, never the other way around.
    const finishing = { outcome };
    task.finishing = finishing;
    // A finished run must not plan another step or keep the stop control armed.
    this.#again = false;
    this.deps.otp.cancelAll();
    await this.deps.cdp?.detach().catch(() => undefined);
    if (
      this.#task !== task ||
      isTerminal(task.status) ||
      task.finishing !== finishing ||
      (task.cancellationRequested && outcome !== 'cancelled')
    )
      return;
    const report = buildReport(task.memory, task.records.list(), outcome, summary, task.exports);
    report.skipped = [...report.skipped, ...task.skipped].slice(-100);
    if (outcome === 'partially_completed') {
      report.partial = [
        ...report.partial,
        ...task.memory.issues.filter((issue) => /could not|inaccessible/i.test(issue)),
      ].slice(-100);
    }
    task.report = report;
    task.pendingPreview = undefined;
    task.pendingQuestion = undefined;
    task.tabChoices = undefined;
    const event: TaskEvent = {
      completed: 'finish',
      partially_completed: 'partial',
      failed: 'fail',
      cancelled: 'cancel',
    }[outcome] as TaskEvent;
    task.status = transition(task.status, event);
    task.completedAt = this.deps.clock();
    const finishedAt = task.completedAt;
    task.timeline = task.timeline.map((step) =>
      step.status === 'active'
        ? { ...step, status: 'completed' as const, completedAt: step.completedAt ?? finishedAt }
        : step,
    );
    this.#timeline(
      task,
      'final',
      outcome === 'completed' ? 'Task completed' : summary,
      outcome === 'failed' ? 'error' : 'completed',
      outcome === 'completed' ? summary : undefined,
    );
    this.#teardown(task);
    await this.deps.checkpoints.clear().catch(() => undefined);
    this.deps.emit({ type: 'milestone', text: summary.slice(0, 1_000) });
    this.#broadcast();
  }

  // ───────────────────────── loop ─────────────────────────

  #kick(): void {
    if (this.#loop) {
      this.#again = true;
      return;
    }
    this.#loop = (async () => {
      try {
        do {
          this.#again = false;
          while (this.#task && this.#task.status === 'running' && !this.#task.timedRepeatId) {
            await this.#iterate(this.#task);
          }
        } while (this.#again && this.#task?.status === 'running');
      } catch (error) {
        const task = this.#task;
        if (task && !isTerminal(task.status)) {
          await this.#finishTask(
            'failed',
            error instanceof Error ? error.message : 'Nudge hit an unexpected error.',
          );
        }
      } finally {
        this.#loop = undefined;
      }
    })();
  }

  async #iterate(task: Task): Promise<void> {
    if (this.#scheduler.budgetExceeded(this.deps.limits ?? DEFAULT_BUDGET)) {
      this.#set('budget_reached');
      this.deps.emit({
        type: 'milestone',
        text: 'I reached this run’s step budget. Say continue to keep going.',
      });
      return;
    }
    const ticket = this.#scheduler.ticket;
    task.tabs = await this.deps.tabs.list();
    if (task.boundTabClosed || !task.tabs.some((tab) => tab.tabId === task.boundTabId)) {
      this.#askForTab(
        task,
        'The tab I was working in was closed. Which tab should I use?',
        task.tabs,
      );
      return;
    }

    const observation = await this.#observe(task);
    if (!this.#scheduler.isCurrent(ticket) || task.status !== 'running') return;

    const request = this.#plannerRequest(task, observation);
    if (this.#needsExplicitApi(task)) {
      this.#offerPlanApproval(task);
      return;
    }
    task.notes = [];
    task.lastResult = undefined;
    let response: PlannerResponse;
    const abort = new AbortController();
    this.#planAbort = abort;
    try {
      response = await this.deps.planner.plan(request, abort.signal, this.#providerOverride(task));
    } catch (error) {
      if (!this.#scheduler.isCurrent(ticket) || task.status !== 'running') return;
      if (this.#offerFallback(task, error)) return;
      throw error;
    }
    if (!this.#scheduler.isCurrent(ticket) || task.status !== 'running') return;
    task.stepCount += 1;
    if (response.planUpdate) {
      task.memory = applyPlanUpdate(task.memory, response.planUpdate);
      // A model-authored "done" flag is not a verified action. Spoken completion
      // comes only from the controller's checked final report, never this plan.
    }
    await this.#dispatch(task, response, observation);
    await this.#checkpoint(task);
    this.#broadcast();
  }

  async #observe(task: Task): Promise<Observation | null> {
    if (!task.snapshotFresh || !task.snapshot) {
      const snapshot = await this.#readPage(task.boundTabId);
      if (!snapshot) {
        task.tabs = await this.deps.tabs.list();
        const alternatives = task.tabs.filter((tab) => tab.tabId !== task.boundTabId);
        if (alternatives.length) {
          this.#askForTab(
            task,
            'I could not read this page. Choose another tab, or reload this page and try again.',
            alternatives,
          );
          return null;
        }
        throw new Error(
          'Nudge could not read this page. Reload it and try again. Chrome blocks extension access on some internal pages.',
        );
      }
      this.#noteSnapshot(task, snapshot);
    }
    task.snapshotFresh = false;
    const snapshot = task.snapshot!;
    let screenshot: Observation['screenshot'];
    if (task.wantScreenshot) {
      task.wantScreenshot = false;
      if (!this.deps.capabilities().vision) {
        task.notes.push(
          'Screenshots are unavailable: the selected model cannot see images. Use DOM tools or report the limitation.',
        );
      } else {
        try {
          screenshot = await this.deps.screenshots.capture(task.boundTabId, snapshot);
          task.frame = screenshot.frame;
        } catch (error) {
          task.notes.push(
            `Screenshot failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
          );
        }
      }
    }
    return { tabId: task.boundTabId, snapshot, ...(screenshot ? { screenshot } : {}) };
  }

  /** Observe a tab, retrying briefly while a newly loaded page's content script starts. */
  async #readPage(tabId: number): Promise<PageSnapshot | undefined> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const result = await this.deps.content.send(tabId, { type: 'observe' });
        if (result.snapshot) return result.snapshot;
      } catch {
        /* page still loading; retry */
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    return undefined;
  }

  #noteSnapshot(task: Task, snapshot: PageSnapshot): void {
    task.snapshot = snapshot;
    for (const element of snapshot.elements) if (element.href) task.observedUrls.add(element.href);
    task.observedUrls.add(snapshot.url);
    task.memory = addSource(task.memory, snapshot.url);
    const current = task.tabs.find((tab) => tab.tabId === task.boundTabId);
    if (current) {
      const parsed = new URL(snapshot.url);
      task.sources.set(snapshot.url, {
        ...current,
        url: snapshot.url,
        title: snapshot.title || current.title,
        domain: parsed.hostname,
        lastSeenAt: new Date(this.deps.clock()).toISOString(),
      });
    }
    if (snapshot.inaccessible.includes('canvas')) {
      task.memory = addIssue(
        task.memory,
        'Part of this page is a canvas that could not be read as page structure.',
      );
    }
  }

  #plannerRequest(task: Task, observation: Observation | null): PlannerRequest {
    const records = task.records.list();
    const notes = [...task.notes];
    const sheet = spreadsheetCue(observation?.snapshot);
    if (sheet) notes.push(sheet);
    if (records.length) {
      notes.push(
        `${records.length} records collected so far (${task.records.unsaved().length} not yet written to a destination). Latest: ${records
          .slice(-3)
          .map((record) => Object.values(record.fields).slice(0, 2).join(' / '))
          .join('; ')}`.slice(0, 1_000),
      );
    }
    return {
      requestId: crypto.randomUUID(),
      taskId: task.id,
      generation: this.#scheduler.generation,
      instructionVersion: this.#scheduler.instructionVersion,
      goal: task.memory.goal,
      memory: { ...plannerView(task.memory), recordCount: records.length },
      authorization: task.authorization,
      observation,
      tabs: task.tabs,
      ...(task.lastResult ? { lastResult: task.lastResult } : {}),
      capabilities: {
        vision: this.deps.capabilities().vision,
        trustedInput: this.#capability === 'dom_plus_trusted_input',
      },
      notes: notes.map((note) => note.slice(0, 1_000)).slice(-20),
      ...this.#timeContext(),
    };
  }

  #timeZone(): string {
    const zone = this.deps.timeZone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return zone;
    } catch {
      return 'UTC';
    }
  }

  /** Every provider gets the real current time and the user's timezone, not the server's. */
  #timeContext(): { currentTime: string; timeZone: string } {
    const timeZone = this.#timeZone();
    const now = new Date(this.deps.clock());
    const local = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(now);
    return { timeZone, currentTime: `${now.toISOString()} (user timezone: ${timeZone}; local time ${local})`.slice(0, 150) };
  }

  /** The user's own words for this task: instruction, corrections and answers. */
  #userText(task: Task): string {
    return [task.instruction, ...task.memory.constraints.map((item) => item.text)].join('\n');
  }

  // ───────────────────────── dispatch ─────────────────────────

  async #dispatch(
    task: Task,
    response: PlannerResponse,
    observation: Observation | null,
  ): Promise<void> {
    const call = response.toolCall;
    const label = describeCall(call, task.snapshot);
    const stepId = `step_${task.stepCount}`;
    switch (call.tool) {
      case 'list_tabs':
        task.tabs = await this.deps.tabs.list();
        task.lastResult = { tool: call.tool, ok: true, detail: `${task.tabs.length} tabs listed.` };
        return;
      case 'observe_tab':
        if (!task.tabs.some((tab) => tab.tabId === call.tabId)) {
          task.lastResult = { tool: call.tool, ok: false, detail: 'That tab is not available.' };
          return;
        }
        if (call.tabId !== task.boundTabId) this.#rebind(call.tabId);
        task.wantScreenshot = call.screenshot === true;
        task.lastResult = { tool: call.tool, ok: true, detail: 'Observing again.' };
        return;
      case 'read_text':
      case 'inspect_element':
      case 'wait_for': {
        const policy = this.#policy(task, call, response);
        if (policy.decision !== 'allow') return this.#handlePolicy(task, call, policy, label);
        const result = await this.deps.content.send(task.boundTabId, {
          type: 'execute',
          call,
          documentId: task.snapshot!.documentId,
          generation: this.#scheduler.generation,
        });
        const detail = result.text
          ? `Text (untrusted): ${result.text.slice(0, 1_800)}`
          : result.detail;
        task.lastResult = { tool: call.tool, ok: result.ok, detail: detail.slice(0, 2_000) };
        return;
      }
      case 'get_candidate_profile':
      case 'list_documents':
      case 'search_cv':
        await this.#profileTool(task, call);
        return;
      case 'attach_document':
        await this.#attachDocument(task, call, response, label, stepId);
        return;
      case 'calendar_open_event_editor':
        await this.#openCalendarEditor(task, call, stepId);
        return;
      case 'calendar_find_event':
        await this.#findCalendarEvent(task, call, stepId);
        return;
      case 'ask_user':
        this.#askUser(task, call.question);
        return;
      case 'request_confirmation':
        this.#preview(task, call.preview, observation?.snapshot);
        return;
      case 'record_items': {
        const snapshot = task.snapshot;
        const evidence = {
          texts: [
            ...(snapshot?.text ?? []),
            ...(snapshot?.elements ?? []).flatMap((element) => [
              element.name ?? '',
              element.text ?? '',
            ]),
          ],
          hrefs: [...task.observedUrls],
          values: (snapshot?.elements ?? []).flatMap((element) =>
            element.value ? [element.value] : [],
          ),
        };
        let added = 0;
        let unknown = 0;
        for (const record of call.records) {
          const outcome = task.records.add(
            {
              fields: recordFieldsToObject(record.fields),
              sourceUrl: record.sourceUrl,
              observedAt: new Date(this.deps.clock()).toISOString(),
            },
            evidence,
          );
          if (outcome.added) added += 1;
          unknown += Object.values(outcome.record.fields).filter(
            (value) => value === 'unknown',
          ).length;
          if (snapshot) task.memory = addSource(task.memory, snapshot.url);
        }
        task.memory = { ...task.memory, recordCount: task.records.list().length };
        task.memory = appendStep(task.memory, {
          tool: call.tool,
          summary: `Recorded ${added} new items (${call.records.length - added} duplicates)`,
          ok: true,
          evidence: `${unknown} fields not shown on the page were stored as unknown`,
        });
        task.lastResult = {
          tool: call.tool,
          ok: true,
          detail: `Recorded ${added} new, ${call.records.length - added} duplicates; ${unknown} unsupported fields stored as unknown.`,
        };
        this.#timeline(task, stepId, `Recorded ${added} items`, 'completed');
        return;
      }
      case 'export_records':
        this.#export(task, call.format);
        task.lastResult = {
          tool: call.tool,
          ok: true,
          detail: `Prepared ${call.format.toUpperCase()} download.`,
        };
        return;
      case 'finish': {
        const pending = task.memory.plan.some(
          (item) => item.status === 'pending' || item.status === 'active',
        );
        const inaccessible = task.memory.issues.some((issue) => /could not be read/i.test(issue));
        // A planner claim is not verification. Accept concrete observed text for
        // read-only answers, or the evidence recorded by our action verifier.
        const observed = observation?.snapshot;
        const pageEvidence = observed
          ? [
              observed.url,
              observed.title,
              ...observed.text,
              ...observed.elements.flatMap((element) => [
                element.name,
                element.text,
                element.value,
              ]),
            ]
              .filter(Boolean)
              .join('\n')
              .toLowerCase()
          : '';
        const groundedEvidence = call.evidence.filter(
          (evidence) =>
            evidence.trim().length >= 3 && pageEvidence.includes(evidence.trim().toLowerCase()),
        );
        const verifiedAction = task.memory.steps.some((step) => step.ok && step.evidence);
        const navigationTarget = task.instruction
          .match(
            /^\s*(?:(?:please|can you|could you)\s+)*(?:open|visit|go to|navigate to|take me to)\s+(.+?)[.!?]*$/i,
          )?.[1]
          ?.replace(/\s+in (?:a |the )?(?:new|current|this) tab$/i, '')
          .trim();
        const verifiedNavigation = task.memory.steps.some(
          (step) =>
            step.ok &&
            step.evidence &&
            (['navigate', 'open_tab', 'activate_tab', 'go_back', 'go_forward'].includes(
              step.tool,
            ) ||
              step.evidence.startsWith('Now at ')),
        );
        let atRequestedDestination = false;
        if (navigationTarget && observed) {
          try {
            const current = new URL(observed.url);
            if (/^(?:https?:\/\/|[\w-]+\.)/i.test(navigationTarget)) {
              const target = new URL(
                /^https?:\/\//i.test(navigationTarget)
                  ? navigationTarget
                  : `https://${navigationTarget}`,
              );
              atRequestedDestination =
                current.hostname === target.hostname &&
                current.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '') &&
                (!target.search || current.search === target.search);
            } else {
              // A site name must match a host label, not arbitrary page text
              // (for example a Google result mentioning the requested site).
              atRequestedDestination = current.hostname
                .split('.')
                .includes(navigationTarget.toLowerCase());
            }
          } catch {
            /* An unfamiliar destination still requires verified navigation. */
          }
        }
        const completionVerified = navigationTarget
          ? verifiedNavigation || atRequestedDestination
          : verifiedAction || groundedEvidence.length > 0;
        if (task.calendar && task.calendar.saveAttempts > 0 && !task.calendar.verified) {
          task.rejectedFinishes += 1;
          task.lastResult = {
            tool: 'finish',
            ok: false,
            verified: false,
            errorCategory: 'missing_information',
            recoverable: true,
            detail:
              'The event was not confirmed to exist. Call calendar_find_event for the intended title and date before finishing.',
          };
          if (task.rejectedFinishes >= 3)
            await this.#finishTask(
              'partially_completed',
              `I clicked Save for “${task.calendar.title}” but could not confirm the event exists in your calendar. Please check ${task.calendar.timing.label}.`,
            );
          return;
        }
        if (!pending && !inaccessible && !completionVerified) {
          task.rejectedFinishes += 1;
          task.lastResult = {
            tool: 'finish',
            ok: false,
            detail:
              'Completion was not verified. Perform the requested action or provide exact evidence from the current observation. Scope understanding and a completion claim are not evidence.',
          };
          if (task.rejectedFinishes >= 2) {
            await this.#finishTask(
              'failed',
              'I could not verify that the requested task was completed.',
            );
          }
          return;
        }
        if (task.snapshot) task.memory = addSource(task.memory, task.snapshot.url);
        task.memory = appendStep(task.memory, {
          tool: 'finish',
          summary: call.summary.slice(0, 1_000),
          ok: true,
          ...(groundedEvidence.length
            ? { evidence: groundedEvidence.join('; ').slice(0, 1_000) }
            : {}),
        });
        await this.#finishTask(
          pending || inaccessible ? 'partially_completed' : 'completed',
          call.summary,
        );
        return;
      }
      case 'report_partial': {
        task.memory = applyPlanUpdate(task.memory, [
          ...task.memory.plan.filter(
            (item) => item.status !== 'pending' && item.status !== 'active',
          ),
          ...call.remaining.map((text, index) => ({
            id: `remaining_${index}`,
            text: text.slice(0, 500),
            status: 'pending' as const,
          })),
        ]);
        task.memory = addIssue(task.memory, call.reason);
        await this.#finishTask(
          call.done.length || task.memory.steps.length ? 'partially_completed' : 'failed',
          call.reason,
        );
        return;
      }
      case 'start_timed_repeat': {
        const policy = this.#policy(task, call, response);
        if (policy.decision !== 'allow') return this.#handlePolicy(task, call, policy, label);
        const origin = (() => {
          try {
            return new URL(task.snapshot?.url ?? '').origin;
          } catch {
            return '';
          }
        })();
        const valid = validateTimedRepeat(call, {
          authorization: task.authorization,
          tabOrigin: origin,
        });
        if (!valid.ok) {
          task.lastResult = { tool: call.tool, ok: false, detail: valid.reason };
          return;
        }
        const repeatId = `repeat_${crypto.randomUUID()}`;
        const result = await this.deps.content.send(task.boundTabId, {
          type: 'timed_start',
          repeatId,
          action: call.action,
          intervalMs: call.intervalMs,
          maxDurationMs: call.maxDurationMs,
          stopAtEnd: call.stopAtEnd ?? false,
        });
        if (!result.ok) {
          task.lastResult = { tool: call.tool, ok: false, detail: result.detail };
          return;
        }
        task.timedRepeatId = repeatId;
        task.memory = appendStep(task.memory, {
          tool: call.tool,
          summary: `Repeating every ${Math.round(call.intervalMs / 1000)} s until you say stop`,
          ok: true,
          evidence: 'Timer started in the page',
        });
        this.#timeline(
          task,
          stepId,
          `Repeating every ${Math.round(call.intervalMs / 1000)} seconds — say “stop” to end`,
          'active',
        );
        this.deps.emit({
          type: 'milestone',
          text: `Repeating every ${Math.round(call.intervalMs / 1000)} seconds. Say stop when you want me to end.`,
        });
        return;
      }
      default:
        await this.#mutate(task, call, response, label, stepId);
    }
  }

  #policy(task: Task, call: ToolCall, response: PlannerResponse) {
    const snapshot = task.snapshot;
    const records = task.records.list();
    let visualTarget: RiskTarget | undefined;
    if ('x' in call && 'y' in call && snapshot) {
      const hit = snapshot.elements.find(
        (element) =>
          element.rect &&
          call.x >= element.rect.x &&
          call.x <= element.rect.x + element.rect.width &&
          call.y >= element.rect.y &&
          call.y <= element.rect.y + element.rect.height,
      );
      if (hit) visualTarget = hit;
    }
    return evaluateToolCall(
      {
        status: task.status,
        boundTabId: task.boundTabId,
        knownTabIds: task.tabs.map((tab) => tab.tabId),
        tabRoles: Object.fromEntries(task.memory.tabs.map((tab) => [tab.tabId, tab.role])),
        documentId: snapshot?.documentId ?? '',
        snapshot,
        authorization: task.authorization,
        navigation: {
          userTypedUrls: task.userTypedUrls,
          observedUrls: [...task.observedUrls],
          taskOrigins: task.memory.tabs.map((tab) => tab.origin).filter(Boolean),
          recordValues: records
            .flatMap((record) => Object.values(record.fields))
            .filter((value) => value !== 'unknown'),
        },
        frame: task.frame,
        ...(snapshot
          ? {
              frameCurrent: {
                tabId: task.boundTabId,
                documentId: snapshot.documentId,
                url: snapshot.url,
                scrollX: snapshot.viewport.scrollX,
                scrollY: snapshot.viewport.scrollY,
                cssWidth: snapshot.viewport.width,
                cssHeight: snapshot.viewport.height,
                mutationCounter: snapshot.mutationCounter ?? 0,
              },
            }
          : {}),
        now: this.deps.clock(),
        riskLabel: response.riskLabel,
        confirmation: task.confirmation,
        currentFingerprint: this.#currentFingerprint(task, call),
        generation: this.#scheduler.generation,
        bulkCount: Math.max(1, selection(snapshot).length),
        visualTarget,
      },
      call,
    );
  }

  #currentFingerprint(task: Task, call?: ToolCall): string | undefined {
    // A calendar save is bound to the intended event, not to checkboxes in the editor.
    if (call && task.calendar && this.#isCalendarSave(task, call))
      return targetFingerprint([`calendar:${task.calendar.fingerprint}`]);
    const selected = selection(task.snapshot);
    if (selected.length) return targetFingerprint(selected);
    return task.confirmation?.targetFingerprint;
  }

  #handlePolicy(task: Task, call: ToolCall, policy: PolicyOutcome, label: string): void {
    if (policy.decision === 'confirm' && task.calendar && this.#isCalendarSave(task, call)) {
      const draft = task.calendar;
      this.#preview(
        task,
        {
          operation: `Save calendar event “${draft.title}”`.slice(0, 200),
          location: 'Google Calendar',
          criteria: `${draft.timing.label}${draft.attendees.length ? `; guests: ${draft.attendees.join(', ')}` : '; no guests'}`.slice(0, 1_000),
          count: 1,
          samples: [draft.timing.label.slice(0, 300), ...draft.attendees.slice(0, 4)],
          reversible: true,
          permanent: false,
        },
        undefined,
        targetFingerprint([`calendar:${draft.fingerprint}`]),
      );
      return;
    }
    if (policy.decision === 'confirm') {
      const selected = selection(task.snapshot);
      const target =
        'elementId' in call && call.elementId
          ? task.snapshot?.elements.find((element) => element.id === call.elementId)
          : undefined;
      // Re-preview the same operation in the user's terms when the target set changed.
      const previous = task.lastPreview;
      this.#preview(
        task,
        {
          operation: previous?.operation ?? (target?.name ?? label).slice(0, 200),
          location:
            previous?.location ?? (task.snapshot?.title || task.snapshot?.url || 'this page'),
          criteria: previous?.criteria ?? task.instruction.slice(0, 1_000),
          count: Math.max(1, selected.length),
          samples: selected.slice(0, 5),
          reversible: previous?.reversible ?? policy.category === 'move_reversible',
          permanent: previous?.permanent ?? policy.category === 'delete_permanent',
        },
        task.snapshot,
      );
      return;
    }
    if (policy.decision === 'clarify') {
      this.#askUser(task, policy.question);
      return;
    }
    if (policy.decision === 'block') {
      task.lastResult = { tool: call.tool, ok: false, detail: `Blocked: ${policy.reason}` };
      task.skipped.push({ item: label, reason: policy.reason });
      task.memory = appendStep(task.memory, {
        tool: call.tool,
        summary: `${label} — not done: ${policy.reason}`.slice(0, 1_000),
        ok: false,
      });
      this.#timeline(
        task,
        `blocked_${task.stepCount}`,
        `Skipped: ${label}`,
        'error',
        policy.reason,
      );
      // Blocked calls never reach ActionScheduler.run(), so its mutation repeat counter
      // cannot stop a planner repeatedly proposing the same denied operation.
      const context = JSON.stringify([
        task.boundTabId,
        task.snapshot?.documentId,
        task.authorization,
        this.#scheduler.instructionVersion,
      ]);
      if (task.policyBlockContext !== context) {
        task.policyBlockContext = context;
        task.policyBlockCounts.clear();
      }
      // Ignore payload changes (such as a different search query) for the same denied target.
      const targetKeys = [
        'tabId',
        'elementId',
        'fromElementId',
        'toElementId',
        'url',
        'sourceTabId',
        'destinationTabId',
        'destinationElementId',
        'x',
        'y',
        'from',
        'to',
      ];
      const target = Object.fromEntries(
        targetKeys
          .filter((key) => key in call)
          .map((key) => [key, (call as unknown as Record<string, unknown>)[key]]),
      );
      const key = JSON.stringify([policy.reason, target]);
      const count = (task.policyBlockCounts.get(key) ?? 0) + 1;
      task.policyBlockCounts.set(key, count);
      if (count >= 2) {
        this.#askUser(
          task,
          `I could not complete “${label}”: ${policy.reason} I stopped repeating the blocked step. How would you like to proceed?`,
        );
      } else {
        task.notes.push(
          `This action was blocked: ${policy.reason} Choose a permitted alternative or report what remains; do not repeat the same blocked target.`,
        );
      }
    }
  }

  #preview(
    task: Task,
    proposal: Omit<OperationPreview, 'previewId' | 'targetFingerprint'>,
    snapshot?: PageSnapshot,
    fingerprint?: string,
  ): void {
    const selected = selection(snapshot);
    const preview: OperationPreview = {
      ...proposal,
      previewId: `preview_${crypto.randomUUID()}`,
      count: selected.length || proposal.count,
      samples: (selected.length ? selected : proposal.samples).slice(0, 5),
      targetFingerprint:
        fingerprint ??
        (selected.length
          ? targetFingerprint(selected)
          : targetFingerprint([...proposal.samples, `count:${proposal.count}`])),
    };
    task.pendingPreview = preview;
    task.lastPreview = preview;
    task.confirmation = undefined;
    this.#set('need_confirm');
    this.#timeline(
      task,
      `preview_${task.stepCount}`,
      `Waiting for your OK: ${preview.operation} (${preview.count})`,
      'active',
    );
    this.deps.emit({
      type: 'milestone',
      text: `Please confirm: ${preview.operation}, ${preview.count} item${preview.count === 1 ? '' : 's'}.`,
    });
  }

  #askUser(task: Task, question: string): void {
    task.pendingQuestion = question.slice(0, 1_000);
    if (task.status === 'waiting_for_user') this.#broadcast();
    else this.#set('ask');
    this.#timeline(task, `ask_${task.stepCount}`, question.slice(0, 500), 'active');
    this.deps.emit({ type: 'milestone', text: question.slice(0, 1_000) });
  }

  #askForTab(task: Task, question: string, tabs: TabReference[]): void {
    task.tabChoices = tabs.slice(0, 100).map((tab, index) => ({ ...tab, number: index + 1 }));
    this.#askUser(task, question);
  }

  // ───────────────────────── candidate profile ─────────────────────────

  #retrievalFailure(tool: string, error: unknown): ToolResult {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return {
      tool,
      ok: false,
      verified: false,
      errorCategory: 'retrieval_failed',
      recoverable: true,
      detail: `Could not read the saved profile/documents: ${reason}`.slice(0, 1_500) +
        ' This is a retrieval failure, not missing information. Tell the user, suggest checking that the Nudge server is running, and offer to continue with details they type.',
    };
  }

  async #loadProfile(_task: Task): Promise<CandidateProfile> {
    if (!this.deps.profile) throw new Error('Profile access is not connected in this build');
    const abort = new AbortController();
    this.#planAbort = abort;
    return this.deps.profile.candidateProfile(abort.signal);
  }

  async #profileTool(
    task: Task,
    call: Extract<ToolCall, { tool: 'get_candidate_profile' | 'list_documents' | 'search_cv' }>,
  ): Promise<void> {
    try {
      if (call.tool === 'search_cv') {
        if (!this.deps.profile) throw new Error('Profile access is not connected in this build');
        const results = await this.deps.profile.searchCv(call.query);
        task.lastResult = {
          tool: call.tool,
          ok: true,
          verified: true,
          detail: results.length
            ? `${results.length} CV excerpts matched “${call.query.slice(0, 100)}”. Use only what they state.`
            : `No CV text matched “${call.query.slice(0, 100)}”. Treat that detail as missing; do not invent it.`,
          data: JSON.stringify(results).slice(0, 12_000),
        };
        return;
      }
      const profile = await this.#loadProfile(task);
      const data =
        call.tool === 'list_documents'
          ? { selectedDocumentId: profile.selectedDocumentId, selection: profile.selection, documents: profile.documents, notes: profile.notes }
          : profile;
      let json = JSON.stringify(data);
      if (json.length > 12_000) {
        // Keep every field and source; trim long lists first.
        json = JSON.stringify({ ...profile, employment: profile.employment.slice(0, 6), education: profile.education.slice(0, 4), skills: profile.skills.slice(0, 30) }).slice(0, 12_000);
      }
      const found = Object.keys(profile.fields);
      task.lastResult = {
        tool: call.tool,
        ok: true,
        verified: true,
        detail:
          call.tool === 'list_documents'
            ? `${profile.documents.length} saved documents; selection: ${profile.selection}.`
            : profile.status === 'no_documents'
              ? 'No CV or profile details are saved. Ask the user for the required details, or to upload a CV in Account → Documents.'
              : `Profile ${profile.status}: ${found.length} fields with sources (${found.join(', ')}). Missing: ${profile.missing.join(', ') || 'none'}. Conflicts must be asked about; askUser topics are never inferred.`,
        data: json,
      };
      task.memory = appendStep(task.memory, {
        tool: call.tool,
        summary: `Read saved profile (${profile.status})`,
        ok: true,
      });
    } catch (error) {
      task.lastResult = this.#retrievalFailure(call.tool, error);
      task.memory = addIssue(task.memory, 'Saved profile could not be read.');
    }
  }

  async #attachDocument(
    task: Task,
    call: Extract<ToolCall, { tool: 'attach_document' }>,
    response: PlannerResponse,
    label: string,
    stepId: string,
  ): Promise<void> {
    const policy = this.#policy(task, call, response);
    if (policy.decision !== 'allow') return this.#handlePolicy(task, call, policy, label);
    let documentId = call.documentId;
    let filename: string | undefined;
    try {
      const profile = await this.#loadProfile(task);
      if (!documentId) {
        const cvs = profile.documents.filter((document) => document.looksLikeCv);
        if (profile.selection === 'most_recent_cv' && cvs.length > 1) {
          // The choice of file materially affects the application and no preference is saved.
          this.#askUser(
            task,
            `Which CV should I attach: ${cvs.map((document) => `“${document.filename}”`).join(' or ')}? You can also mark one as default in Account → Documents.`,
          );
          return;
        }
        documentId = profile.selectedDocumentId;
      }
      const document = profile.documents.find((item) => item.id === documentId);
      if (!documentId || !document) {
        task.lastResult = { tool: call.tool, ok: false, verified: false, errorCategory: 'missing_information', recoverable: true, detail: 'No saved CV is available to attach. Ask the user to upload one in Account → Documents.' };
        return;
      }
      if (!document.attachable) {
        task.lastResult = { tool: call.tool, ok: false, verified: false, errorCategory: 'missing_information', recoverable: true, detail: `“${document.filename}” was saved as text only, so it cannot be attached. Ask the user to re-upload the file in Account → Documents, or to attach it themselves.` };
        return;
      }
      filename = document.filename;
    } catch (error) {
      task.lastResult = this.#retrievalFailure(call.tool, error);
      return;
    }
    let file: { filename: string; mime: string; base64: string };
    try {
      file = await this.deps.profile!.documentFile(documentId);
    } catch (error) {
      task.lastResult = this.#retrievalFailure(call.tool, error);
      return;
    }
    const fingerprint = fingerprintOf(call);
    this.#timeline(task, stepId, `Attaching ${filename}`, 'active');
    await this.#checkpoint(task, { tool: call.tool, fingerprint });
    const outcome = await this.#scheduler.run({ fingerprint }, () =>
      this.deps.content.send(task.boundTabId, {
        type: 'attach_file',
        elementId: call.elementId,
        documentId: task.snapshot?.documentId ?? '',
        generation: this.#scheduler.generation,
        file: { name: file.filename, mime: file.mime, base64: file.base64 },
      }),
    );
    if (outcome.status !== 'done') {
      task.memory = addIssue(task.memory, `Verify before continuing: attaching ${filename} may or may not have happened.`);
      return;
    }
    const result = outcome.value;
    const after = await this.#readPage(task.boundTabId);
    if (after) {
      this.#noteSnapshot(task, after);
      task.snapshotFresh = true;
    }
    const shown = after?.elements.some((element) => element.files?.includes(file.filename)) || after?.text.some((text) => text.includes(file.filename));
    task.lastResult = {
      tool: call.tool,
      ok: result.ok,
      verified: Boolean(result.ok && shown),
      detail: `${result.detail}${result.ok && !shown ? ' The page does not show the file name yet; check the upload field.' : ''}${result.validation?.length ? ` Validation: ${result.validation.join(' ')}` : ''}`.slice(0, 2_000),
      ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
      recoverable: !result.ok,
      pageChanged: Boolean(after && task.snapshot && result.changed),
    };
    task.memory = appendStep(task.memory, {
      tool: call.tool,
      summary: result.ok ? `Attached ${filename}` : `Could not attach ${filename}: ${result.detail}`.slice(0, 1_000),
      ok: result.ok,
      ...(result.ok && shown ? { evidence: `Upload field shows ${file.filename}` } : {}),
    });
    this.#timeline(task, stepId, result.ok ? `Attached ${filename}` : `Could not attach ${filename}`, result.ok ? 'completed' : 'error', result.ok ? undefined : result.detail);
  }

  // ───────────────────────── calendar ─────────────────────────

  /** Values the user did not give are missing, even when the model proposes them. */
  #calendarMissing(task: Task, call: Extract<ToolCall, { tool: 'calendar_open_event_editor' }>): string[] {
    const text = this.#userText(task);
    const lower = text.toLowerCase();
    const missing: string[] = [];
    const title = call.title.trim().toLowerCase().replace(/\s+/g, ' ');
    const words = title.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2);
    const titleGrounded = lower.includes(title) || (words.length > 0 && words.every((word) => lower.includes(word)));
    if (GENERIC_EVENT_TITLES.has(title) || !titleGrounded) missing.push('title');
    const now = this.deps.clock();
    const zone = this.#timeZone();
    const intended = resolveDate(call.date, now, zone);
    const phrases = [
      ...(lower.match(/\b(?:today|tomorrow|tmrw|day after tomorrow|in \d{1,3} days?)\b/g) ?? []),
      ...(lower.match(/\b(?:this |next |on |coming )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g) ?? []),
      ...(lower.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
      ...(lower.match(/\b\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?: \d{4})?\b/g) ?? []),
      ...(lower.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?(?: \d{4})?\b/g) ?? []),
    ];
    const dates = phrases.map((phrase) => resolveDate(phrase, now, zone)).filter(Boolean);
    if (!intended || !dates.some((date) => date && date.y === intended.y && date.m === intended.m && date.d === intended.d)) missing.push('date');
    const start = parseClock(call.startTime);
    const times = (text.match(TIME_IN_TEXT) ?? []).map((value) => parseClock(value.replace(/\./g, '')));
    if (!start || !times.some((time) => time && time.hour === start.hour && time.minute === start.minute)) missing.push('start time');
    if ((call.durationMinutes !== undefined || call.endTime) && !DURATION_IN_TEXT.test(text)) missing.push('duration or end time');
    if (call.durationMinutes === undefined && !call.endTime) missing.push('duration or end time');
    return [...new Set(missing)];
  }

  async #openCalendarEditor(
    task: Task,
    call: Extract<ToolCall, { tool: 'calendar_open_event_editor' }>,
    stepId: string,
  ): Promise<void> {
    if (call.tabId !== task.boundTabId) {
      task.lastResult = { tool: call.tool, ok: false, errorCategory: 'blocked', detail: 'Switch to that tab before acting in it.' };
      return;
    }
    const userText = this.#userText(task);
    const origins = task.authorization.origins;
    const allowed =
      origins === 'browse_web' ||
      origins.some((origin) => /calendar\.google\.com/.test(origin)) ||
      /\b(?:calendar|meeting|event|schedule|appointment|invite)\b/i.test(userText);
    if (!allowed) {
      task.lastResult = { tool: call.tool, ok: false, errorCategory: 'blocked', detail: 'You did not ask for a calendar event.' };
      return;
    }
    const uninvited = (call.attendees ?? []).filter((email) => !userText.toLowerCase().includes(email.toLowerCase()));
    if (uninvited.length) {
      task.lastResult = {
        tool: call.tool,
        ok: false,
        errorCategory: 'blocked',
        recoverable: true,
        detail: `Attendees must come from the user's words. Not given: ${uninvited.join(', ')}. Remove them or ask the user.`,
      };
      return;
    }
    const missing = this.#calendarMissing(task, call);
    const timing = resolveEventTiming(call, this.deps.clock(), this.#timeZone());
    const allMissing = [...new Set([...missing, ...(timing.ok ? [] : timing.missing.map((item) => item.replace(/ \(.*\)$/, '')))])];
    if (allMissing.length) {
      const known = timing.ok ? ` (${timing.label})` : '';
      this.#askUser(
        task,
        `To create the event${known} I still need: ${allMissing.join(', ')}. ${allMissing.includes('title') ? 'What should it be called? ' : ''}${allMissing.includes('start time') ? 'What time should it start? ' : ''}${allMissing.includes('duration or end time') ? 'How long should it last? ' : ''}${allMissing.includes('date') ? 'Which day? ' : ''}`.trim(),
      );
      return;
    }
    if (!timing.ok) return; // unreachable: missing would be non-empty
    const fingerprint = eventFingerprint(call.title, timing.startLocal);
    if (task.calendar?.fingerprint === fingerprint && task.calendar.verified) {
      task.lastResult = { tool: call.tool, ok: false, errorCategory: 'blocked', detail: 'This event already exists in the calendar; do not create it again.' };
      return;
    }
    if (task.calendar?.fingerprint === fingerprint && task.calendar.needsLookup) {
      task.lastResult = {
        tool: call.tool,
        ok: false,
        errorCategory: 'blocked',
        recoverable: true,
        detail: 'A save for this event was already attempted. Call calendar_find_event first so no duplicate is created.',
      };
      return;
    }
    const url = googleCalendarTemplateUrl({ title: call.title.trim(), timing, attendees: call.attendees, location: call.location, details: call.details });
    this.#timeline(task, stepId, `Opening Google Calendar's editor for “${call.title}”`, 'active');
    const outcome = await this.#scheduler.run({ fingerprint: `calendar_editor:${fingerprint}` }, async () => {
      await this.deps.tabs.navigate(task.boundTabId, url);
      await this.deps.tabs.waitForComplete(task.boundTabId, 15_000).catch(() => undefined);
      return true;
    });
    if (outcome.status !== 'done') return;
    task.calendar = {
      title: call.title.trim(),
      timing,
      attendees: call.attendees ?? [],
      fingerprint,
      saveAttempts: task.calendar?.fingerprint === fingerprint ? task.calendar.saveAttempts : 0,
      needsLookup: false,
      verified: false,
    };
    task.observedUrls.add(url);
    let snapshot: PageSnapshot | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      snapshot = await this.#readPage(task.boundTabId);
      if (snapshot && (/accounts\.google\.com/.test(snapshot.url) || snapshot.elements.some((element) => element.value?.trim() === call.title.trim())))
        break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (snapshot) {
      this.#noteSnapshot(task, snapshot);
      task.snapshotFresh = true;
    }
    if (snapshot && /accounts\.google\.com/.test(snapshot.url)) {
      task.lastResult = { tool: call.tool, ok: false, errorCategory: 'blocked', detail: 'Google asks you to sign in.' };
      this.#askUser(task, 'Google Calendar needs you to sign in. Sign in in this tab, then say continue — nothing has been created.');
      return;
    }
    const titleShown = Boolean(snapshot?.elements.some((element) => element.value?.trim() === call.title.trim()));
    const intended = { title: call.title.trim(), when: timing.label, start: timing.startLocal, end: timing.endLocal, timeZone: timing.timeZone, attendees: call.attendees ?? [], location: call.location ?? null };
    task.lastResult = {
      tool: call.tool,
      ok: true,
      verified: titleShown,
      pageChanged: true,
      detail: titleShown
        ? `Calendar's event editor is open and shows the title. Check the date/time/timezone fields match ${timing.label}, then click Save (needs approval). Nothing is saved yet.`
        : `Opened Calendar's event editor for ${timing.label}, but the title field was not observed yet; observe again or wait_for the editor.`,
      data: JSON.stringify({ intended }),
    };
    task.memory = appendStep(task.memory, {
      tool: call.tool,
      summary: `Opened Calendar editor: ${call.title} — ${timing.label}`.slice(0, 1_000),
      ok: true,
      ...(titleShown ? { evidence: `Editor shows title “${call.title}”` } : {}),
    });
    this.#timeline(task, stepId, `Event editor open: ${call.title}, ${timing.label}`, 'completed');
  }

  async #findCalendarEvent(
    task: Task,
    call: Extract<ToolCall, { tool: 'calendar_find_event' }>,
    stepId: string,
  ): Promise<void> {
    const date = resolveDate(call.date, this.deps.clock(), this.#timeZone());
    if (!date) {
      task.lastResult = { tool: call.tool, ok: false, errorCategory: 'missing_information', detail: `Could not resolve the date “${call.date}”.` };
      return;
    }
    const startLocal = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}T00:00`;
    const url = googleCalendarDayUrl({ startLocal });
    this.#timeline(task, stepId, `Checking ${call.date} for “${call.title}”`, 'active');
    const outcome = await this.#scheduler.run({ fingerprint: `calendar_find:${call.title}:${startLocal}:${task.stepCount}` }, async () => {
      await this.deps.tabs.navigate(call.tabId, url);
      await this.deps.tabs.waitForComplete(call.tabId, 15_000).catch(() => undefined);
      return true;
    });
    if (outcome.status !== 'done') return;
    const needle = call.title.trim().toLowerCase();
    let matches: string[] = [];
    let snapshot: PageSnapshot | undefined;
    for (let attempt = 0; attempt < 4 && !matches.length; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 700));
      snapshot = await this.#readPage(task.boundTabId);
      if (!snapshot) continue;
      matches = [...snapshot.text, ...snapshot.elements.flatMap((element) => [element.name ?? '', element.text ?? ''])]
        .filter((value) => value.toLowerCase().includes(needle))
        .map((value) => value.slice(0, 300));
    }
    if (snapshot) {
      this.#noteSnapshot(task, snapshot);
      task.snapshotFresh = true;
    }
    const found = matches.length > 0;
    if (task.calendar && eventFingerprint(call.title, task.calendar.timing.startLocal).split('@')[0] === task.calendar.fingerprint.split('@')[0]) {
      task.calendar.needsLookup = false;
      task.calendar.verified = found;
    }
    task.lastResult = {
      tool: call.tool,
      ok: true,
      verified: found,
      pageChanged: true,
      detail: found
        ? `Found “${call.title}” on ${call.date}. Check the time in the matches before finishing; do not save it again.`
        : `No event titled “${call.title}” is shown on ${call.date}. It was not created${task.calendar?.saveAttempts ? '; you may open the editor and save again (approval required)' : ''}.`,
      data: JSON.stringify({ found, matches: [...new Set(matches)].slice(0, 10), dayView: url }),
    };
    task.memory = appendStep(task.memory, {
      tool: call.tool,
      summary: found ? `Event “${call.title}” exists on ${call.date}` : `Event “${call.title}” not found on ${call.date}`,
      ok: true,
      ...(found ? { evidence: matches[0] } : {}),
    });
    this.#timeline(task, stepId, found ? `Confirmed “${call.title}” is in the calendar` : `“${call.title}” is not in the calendar`, 'completed');
  }

  async #mutate(
    task: Task,
    call: ToolCall,
    response: PlannerResponse,
    label: string,
    stepId: string,
  ): Promise<void> {
    if (!MUTATING_TOOLS.has(call.tool)) {
      task.lastResult = { tool: call.tool, ok: false, detail: 'Unsupported tool.' };
      return;
    }
    if (call.tool === 'transfer_code') {
      const policy = this.#policy(task, call, response);
      if (policy.decision !== 'allow') return this.#handlePolicy(task, call, policy, label);
      return this.#transferCode(task, call, stepId);
    }
    const fingerprint = fingerprintOf(call);
    const before = task.snapshot;
    // No-progress guard: never repeat an action that already left this exact page state unchanged.
    if (task.progress.isForbidden(fingerprint, before?.stateHash)) {
      task.refusedRepeats += 1;
      task.lastResult = {
        tool: call.tool,
        ok: false,
        verified: false,
        errorCategory: 'no_progress',
        recoverable: task.refusedRepeats < 2,
        detail: `Not repeated: “${label}” already made no change to this page twice. Try a different approach: observe again, wait_for the expected element, read validation messages, use choose_option/type_text on the right control, or report the blocker.`,
      };
      if (task.refusedRepeats >= 2) await this.#stopStalled(task, label);
      return;
    }
    const calendarSave = this.#isCalendarSave(task, call);
    if (calendarSave && task.calendar?.verified) {
      task.lastResult = { tool: call.tool, ok: false, errorCategory: 'blocked', detail: `“${task.calendar.title}” already exists in the calendar. Do not save it again.` };
      return;
    }
    if (calendarSave && task.calendar?.needsLookup) {
      task.lastResult = {
        tool: call.tool,
        ok: false,
        errorCategory: 'blocked',
        recoverable: true,
        detail: 'A save was already attempted and its outcome is unconfirmed. Call calendar_find_event first; only save again if the event is not there.',
      };
      return;
    }
    const policy = this.#policy(task, call, response);
    if (policy.decision !== 'allow') return this.#handlePolicy(task, call, policy, label);

    if (VISUAL_TOOLS.has(call.tool) && !(await this.#ensureTrustedInput(task))) return;

    this.#timeline(task, stepId, label, 'active');
    await this.#checkpoint(task, { tool: call.tool, fingerprint });
    const outcome = await this.#scheduler.run({ fingerprint }, () => this.#execute(task, call));
    if (outcome.status === 'superseded') {
      this.#timeline(task, stepId, `${label} — cancelled before it ran`, 'completed');
      return;
    }
    if (calendarSave && task.calendar) {
      // From here on the event may exist; any retry must look it up first.
      task.calendar.saveAttempts += 1;
      task.calendar.needsLookup = true;
    }
    if (outcome.status === 'uncertain') {
      task.memory = appendStep(task.memory, {
        tool: call.tool,
        summary: `${label} — outcome uncertain (interrupted)`,
        ok: false,
        uncertain: true,
      });
      task.memory = addIssue(
        task.memory,
        `Verify before continuing: ${label} may or may not have happened.`,
      );
      this.#timeline(task, stepId, `${label} — interrupted`, 'error');
      await this.#checkpoint(task);
      return;
    }
    const result = outcome.value;
    if (!result.ok) {
      const extras = [
        result.fieldValue !== undefined ? `Field now holds: “${result.fieldValue.slice(0, 200)}”.` : '',
        result.options?.length ? `Available options: ${result.options.slice(0, 20).join(' | ')}.` : '',
        result.validation?.length ? `Validation: ${result.validation.join(' ')}` : '',
      ].filter(Boolean);
      task.lastResult = {
        tool: call.tool,
        ok: false,
        verified: false,
        detail: [result.detail, ...extras].join(' ').slice(0, 2_000),
        ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
        recoverable: true,
        pageChanged: false,
      };
      if (result.errorCategory === 'stale_element' || /stale|no longer exists/i.test(result.detail)) {
        // Refresh references before the next decision.
        task.snapshotFresh = false;
        task.notes.push('Element references were refreshed; use IDs from the new observation only.');
      }
      task.memory = appendStep(task.memory, {
        tool: call.tool,
        summary: `${label} — failed: ${result.detail}`.slice(0, 1_000),
        ok: false,
      });
      this.#noteSpreadsheetEdit(task, call, false);
      this.#timeline(task, stepId, label, 'error', result.detail);
      if (this.#scheduler.repeatCount(fingerprint) >= 3) this.#noteRepeat(task);
      return;
    }

    // Let any navigation the action triggered finish, then verify against a fresh observation.
    if (!['open_tab', 'activate_tab', 'close_tab'].includes(call.tool)) {
      await this.deps.tabs.waitForComplete(task.boundTabId, 10_000).catch(() => undefined);
    }
    const afterSnapshot = await this.#readPage(task.boundTabId);
    const after = afterSnapshot ? { snapshot: afterSnapshot } : undefined;
    if (afterSnapshot) {
      this.#noteSnapshot(task, afterSnapshot);
      task.snapshotFresh = true;
    }
    const expectation: Expectation =
      response.expectation ??
      (call.tool === 'type_text' && call.mode === 'replace'
        ? { kind: 'value_equals', elementId: call.elementId, value: call.text }
        : ['navigate', 'go_back', 'go_forward', 'open_tab'].includes(call.tool)
          ? { kind: 'url_changed' }
          : { kind: 'count_changed' });
    const verification = after?.snapshot
      ? checkExpectation(expectation, before, after.snapshot, result)
      : { verified: false, reason: 'Could not re-read the page.' };
    if (verification.verified || result.changed) this.#scheduler.noteProgress();
    if (verification.verified && call.tool === 'type_text')
      this.#markSavedRecords(task, call.text, call.elementId);
    if (call.tool === 'type_text') this.#noteSpreadsheetEdit(task, call, true);
    if (verification.verified && VISUAL_TOOLS.has(call.tool)) {
      task.memory = {
        ...task.memory,
        issues: task.memory.issues.filter((issue) => !/could not be read/i.test(issue)),
      };
    }
    task.memory = appendStep(task.memory, {
      tool: call.tool,
      summary: label,
      ok: true,
      ...(verification.verified && verification.evidence
        ? { evidence: verification.evidence }
        : {}),
    });
    const pageChanged = Boolean(
      before && afterSnapshot && (before.stateHash && afterSnapshot.stateHash ? before.stateHash !== afterSnapshot.stateHash : before.url !== afterSnapshot.url),
    );
    const extras = [
      result.fieldValue !== undefined && call.tool !== 'type_text' ? `Control shows: “${result.fieldValue.slice(0, 200)}”.` : '',
      result.options?.length ? `Suggestions offered: ${result.options.slice(0, 15).join(' | ')}.` : '',
      afterSnapshot?.validation?.length ? `Validation messages on page: ${afterSnapshot.validation.slice(0, 5).join(' | ')}` : '',
      calendarSave ? 'Save clicked. Confirm with calendar_find_event before finishing; do not click Save again.' : '',
    ].filter(Boolean);
    task.lastResult = {
      tool: call.tool,
      ok: true,
      verified: verification.verified,
      pageChanged,
      ...(afterSnapshot?.validation?.length && !verification.verified ? { errorCategory: 'validation_error' as const } : {}),
      detail: [
        verification.verified
          ? `Verified: ${verification.evidence}`
          : `Executed, but the intended outcome was not observed: ${verification.reason ?? ''}`,
        ...extras,
      ]
        .join(' ')
        .slice(0, 2_000),
    };
    const progress = task.progress.record({
      fingerprint,
      beforeHash: before?.stateHash,
      afterHash: afterSnapshot?.stateHash,
      verified: verification.verified,
    });
    if (pageChanged || verification.verified) task.refusedRepeats = 0;
    if (progress.forbidRepeat)
      task.notes.push(
        `“${label}” did not change the page (${progress.sameActionNoChange}×). Do not repeat it; observe again, wait for loading, check validation, or try a different control.`,
      );
    if (progress.exhausted) {
      await this.#stopStalled(task, label);
      return;
    }
    this.#timeline(
      task,
      stepId,
      label,
      'completed',
      verification.verified ? verification.evidence : undefined,
    );
    if (call.tool === 'click' || call.tool === 'type_text')
      task.confirmation =
        task.confirmation && this.#currentFingerprint(task, call) === task.confirmation.targetFingerprint
          ? task.confirmation
          : undefined;
    if (this.#scheduler.repeatCount(fingerprint) >= 3) this.#noteRepeat(task);
  }

  async #execute(task: Task, call: ToolCall): Promise<ContentResult> {
    const documentId = task.snapshot?.documentId ?? '';
    const ok = (detail: string, changed = true): ContentResult => ({
      ok: true,
      detail,
      changed,
      documentId,
    });
    switch (call.tool) {
      case 'open_tab': {
        const opened = await this.deps.tabs.open(call.url);
        await this.deps.tabs.waitForComplete(opened.tabId, 15_000);
        task.tabs = await this.deps.tabs.list();
        task.memory = setTabRole(task.memory, opened, 'opened_by_nudge');
        this.#rebind(opened.tabId);
        return ok('Opened a new tab.');
      }
      case 'activate_tab': {
        const tab = await this.deps.tabs.activate(call.tabId);
        if (!task.memory.tabs.some((entry) => entry.tabId === tab.tabId))
          task.memory = setTabRole(task.memory, tab, 'other');
        this.#rebind(call.tabId);
        return ok(`Switched to ${tab.title}.`);
      }
      case 'navigate':
        await this.deps.tabs.navigate(call.tabId, call.url);
        return ok('Navigated.');
      case 'go_back':
        await this.deps.tabs.goBack(call.tabId);
        return ok('Went back.');
      case 'go_forward':
        await this.deps.tabs.goForward(call.tabId);
        return ok('Went forward.');
      case 'reload':
        await this.deps.tabs.reload(call.tabId);
        return ok('Reloaded.');
      case 'close_tab':
        await this.deps.tabs.close(call.tabId);
        return ok('Closed the tab.');
      case 'click_at':
      case 'double_click_at':
      case 'drag_at':
      case 'type_at':
        return this.#executeVisual(task, call, documentId);
      default:
        try {
          return await this.deps.content.send(task.boundTabId, {
            type: 'execute',
            call: call as never,
            documentId,
            generation: this.#scheduler.generation,
          });
        } catch (error) {
          // The action ran and the page unloaded before replying (e.g. a link click). Verification
          // re-observes the new page, so record it as a navigation instead of a failure.
          if (
            error instanceof Error &&
            /message channel closed|back\/forward cache|port closed/i.test(error.message)
          ) {
            return { ok: true, detail: 'The page navigated.', changed: true, documentId };
          }
          throw error;
        }
    }
  }

  async #executeVisual(
    task: Task,
    call: Extract<ToolCall, { tool: 'click_at' | 'double_click_at' | 'drag_at' | 'type_at' }>,
    documentId: string,
  ): Promise<ContentResult> {
    const cdp = this.deps.cdp!;
    if (cdp.attachedTabId() !== task.boundTabId) {
      try {
        await cdp.attach(task.boundTabId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Trusted input is unavailable.';
        this.#capability = 'dom_only';
        this.deps.emit({
          type: 'need_capability',
          capability: 'trusted_input',
          reason: reason.slice(0, 1_000),
        });
        return { ok: false, detail: reason, changed: false, documentId };
      }
    }
    this.#capability = 'dom_plus_trusted_input';
    const point = call.tool === 'drag_at' ? call.from : { x: call.x, y: call.y };
    await this.deps.content
      .send(task.boundTabId, { type: 'cursor', x: point.x, y: point.y })
      .catch(() => undefined);
    if (call.tool === 'click_at') await cdp.click(call.x, call.y);
    if (call.tool === 'double_click_at') await cdp.click(call.x, call.y, { double: true });
    if (call.tool === 'type_at') {
      await cdp.click(call.x, call.y);
      await cdp.insertText(call.text);
    }
    if (call.tool === 'drag_at') {
      await cdp.drag(call.from, call.to);
      await this.deps.content
        .send(task.boundTabId, { type: 'cursor', x: call.to.x, y: call.to.y })
        .catch(() => undefined);
    }
    task.frame = undefined; // coordinates from this frame must not be reused after a trusted action
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: true, detail: 'Trusted input dispatched.', changed: true, documentId };
  }

  async #ensureTrustedInput(task: Task): Promise<boolean> {
    const cdp = this.deps.cdp;
    if (cdp && this.#capability === 'dom_plus_trusted_input' && (await cdp.available()))
      return true;
    if (cdp && (await cdp.available())) {
      this.#capability = 'dom_plus_trusted_input';
      return true;
    }
    task.capabilityLost = true;
    this.deps.emit({
      type: 'need_capability',
      capability: 'trusted_input',
      reason:
        'This page needs real mouse and keyboard input (for example a canvas editor). Chrome will show a “started debugging this browser” bar while Nudge controls the tab.',
    });
    this.#askUser(
      task,
      'This step needs real mouse and keyboard input. Allow Nudge to control this tab’s input, or tell me to stop.',
    );
    return false;
  }

  async #transferCode(
    task: Task,
    call: Extract<ToolCall, { tool: 'transfer_code' }>,
    stepId: string,
  ): Promise<void> {
    const known = (id: number) => task.tabs.some((tab) => tab.tabId === id);
    if (!known(call.sourceTabId) || !known(call.destinationTabId)) {
      task.lastResult = {
        tool: call.tool,
        ok: false,
        detail: 'Source or destination tab is not available.',
      };
      return;
    }
    let destinationDocumentId =
      task.boundTabId === call.destinationTabId ? task.snapshot?.documentId : undefined;
    if (!destinationDocumentId) {
      destinationDocumentId = (
        await this.deps.content.send(call.destinationTabId, { type: 'observe' })
      ).snapshot?.documentId;
    }
    if (
      !destinationDocumentId ||
      !call.destinationElementId.startsWith(`${destinationDocumentId}:`)
    ) {
      task.lastResult = {
        tool: call.tool,
        ok: false,
        detail: 'The destination field is from an older page; observe the destination tab again.',
      };
      return;
    }
    const fingerprint = fingerprintOf(call);
    this.#timeline(task, stepId, 'Copying the code to the verification page', 'active');
    await this.#checkpoint(task, { tool: call.tool, fingerprint });
    const outcome = await this.#scheduler.run({ fingerprint }, () =>
      this.deps.otp.transfer({
        taskId: task.id,
        generation: this.#scheduler.generation,
        sourceTabId: call.sourceTabId,
        service: call.service,
        destinationTabId: call.destinationTabId,
        destinationElementId: call.destinationElementId,
        destinationDocumentId: destinationDocumentId!,
      }),
    );
    if (outcome.status !== 'done') {
      task.memory = addIssue(
        task.memory,
        'The code transfer was interrupted; check the verification field.',
      );
      return;
    }
    task.memory = appendStep(task.memory, {
      tool: call.tool,
      summary: outcome.value.ok
        ? 'Entered the code into the verification field (not submitted)'
        : `Code not entered: ${outcome.value.detail}`,
      ok: outcome.value.ok,
      ...(outcome.value.ok ? { evidence: outcome.value.detail } : {}),
    });
    task.lastResult = { tool: call.tool, ok: outcome.value.ok, detail: outcome.value.detail };
    this.#timeline(
      task,
      stepId,
      outcome.value.ok ? 'Entered the code (not submitted)' : 'Could not enter the code',
      outcome.value.ok ? 'completed' : 'error',
    );
  }

  // ───────────────────────── helpers ─────────────────────────

  /** A record counts as written once one of its values was typed into a destination and read back. */
  #markSavedRecords(task: Task, text: string, elementId: string): void {
    const value = text.trim().toLowerCase();
    if (!value) return;
    const target = task.snapshot?.elements.find((element) => element.id === elementId);
    for (const record of task.records.unsaved()) {
      const matches = Object.values(record.fields).some(
        (field) => field !== 'unknown' && field.trim().toLowerCase() === value,
      );
      if (!matches || record.sourceUrl === task.snapshot?.url) continue;
      task.records.markSaved(record.id, {
        tabId: task.boundTabId,
        rowHint: (target?.name ?? target?.label ?? elementId).slice(0, 200),
        verifiedAt: new Date(this.deps.clock()).toISOString(),
      });
    }
  }

  #isCalendarSave(task: Task, call: ToolCall): boolean {
    if (!task.calendar || !task.snapshot || !/(^|\.)calendar\.google\.com$/.test((() => {
      try {
        return new URL(task.snapshot.url).hostname;
      } catch {
        return '';
      }
    })()))
      return false;
    const elementId = 'elementId' in call ? call.elementId : undefined;
    const target = elementId ? task.snapshot.elements.find((element) => element.id === elementId) : undefined;
    return classifyRisk(target, call).category === 'submit_form';
  }

  /** Stop looping: preserve state and report the specific blocker and next step. */
  async #stopStalled(task: Task, label: string): Promise<void> {
    const snapshot = task.snapshot;
    const blocker = [
      `I stopped because “${label}” kept leaving the page unchanged.`,
      snapshot?.dialog?.name ? `A dialog is open: “${snapshot.dialog.name}”.` : '',
      snapshot?.validation?.length ? `The page shows: ${snapshot.validation.slice(0, 3).join(' | ')}.` : '',
      'Everything already entered is kept. Check the page, then tell me how to continue.',
    ]
      .filter(Boolean)
      .join(' ');
    task.memory = addIssue(task.memory, blocker.slice(0, 1_000));
    await this.#finishTask('partially_completed', blocker.slice(0, 4_000));
  }

  #noteRepeat(task: Task): void {
    task.repeatNotes += 1;
    task.notes.push(
      'Repeated action without progress; choose a different approach or report what remains.',
    );
    if (task.repeatNotes > 2) {
      void this.#finishTask(
        'partially_completed',
        'I kept trying the same step without progress, so I stopped here.',
      );
    }
  }

  #correct(text: string, source: 'text' | 'voice'): void {
    const task = this.#task!;
    this.#scheduler.bumpInstruction();
    this.#planAbort?.abort();
    task.memory = addConstraint(task.memory, text, this.#scheduler.instructionVersion);
    task.authorization = extendAuthorization(task.authorization, text);
    task.notes.push(`User changed the instructions (${source}): ${text}`);
    task.progress.reset();
    task.refusedRepeats = 0;
    task.confirmation = undefined;
    task.snapshotFresh = false;
    this.#timeline(
      task,
      `correction_${this.#scheduler.instructionVersion}`,
      `Updated: ${text}`.slice(0, 500),
      'completed',
    );
    if (task.status === 'waiting_for_confirmation') {
      task.pendingPreview = undefined;
      this.#set('declined');
    } else if (task.status === 'paused') this.#set('resume');
    this.#broadcast();
    this.#kick();
  }

  async #tabCorrection(
    tabId: number | undefined,
    tabIndex: number | undefined,
    text: string,
  ): Promise<void> {
    const task = this.#task!;
    task.tabs = await this.deps.tabs.list();
    const candidates = task.tabs.filter((tab) => tab.tabId !== task.boundTabId);
    const numberedTarget =
      tabIndex === undefined
        ? undefined
        : task.tabChoices?.find((choice) => choice.number === tabIndex)?.tabId;
    const target =
      tabId ?? numberedTarget ?? (candidates.length === 1 ? candidates[0]!.tabId : undefined);
    if (target === undefined) {
      if (task.status === 'running') this.#scheduler.bumpGeneration();
      this.#askForTab(
        task,
        'Which tab should I use? Say a number, such as “tab 5,” or choose one below.',
        candidates,
      );
      return;
    }
    this.#scheduler.bumpInstruction();
    this.#rebind(target);
    task.tabChoices = undefined;
    task.notes.push(`User asked to use another tab (${text}). Work in tab ${target} now.`);
    task.memory = addConstraint(task.memory, text, this.#scheduler.instructionVersion);
    if (task.status === 'waiting_for_user') {
      task.pendingQuestion = undefined;
      this.#set('answered');
    }
    this.#kick();
  }

  #rebind(tabId: number): void {
    const task = this.#task!;
    task.boundTabId = tabId;
    task.boundTabClosed = false;
    task.snapshot = undefined;
    task.snapshotFresh = false;
    task.frame = undefined;
    task.tabChoices = undefined;
  }

  #resumeIfWaiting(): void {
    const task = this.#task!;
    if (task.status === 'waiting_for_user') {
      task.pendingQuestion = undefined;
      this.#set('answered');
    }
    this.#kick();
  }

  #needsExplicitApi(task: Task): boolean {
    return Boolean(this.deps.subscriptionText?.()) && !this.deps.subscriptionTools?.() && !task.useOpenAI;
  }

  #offerPlanApproval(task: Task): void {
    task.fallbackOffer = {
      reason:
        'ChatGPT plan browser tools are unavailable in this Nudge installation. Use your OpenAI API key for this task only?',
    };
    task.pendingQuestion =
      'ChatGPT plan browser tools are unavailable in this Nudge installation. Use your OpenAI API key for this task only? Nudge will not switch billing unless you choose it.';
    task.status = task.status === 'planning' ? 'waiting_for_user' : transition(task.status, 'ask');
    this.#broadcast();
  }

  #offerFallback(task: Task, error: unknown): boolean {
    if ((this.#providerOverride(task) ?? this.deps.provider()) !== 'ollama') return false;
    const reason = error instanceof Error ? error.message : 'Ollama could not complete this step.';
    task.fallbackOffer = { reason: reason.slice(0, 1_000) };
    task.pendingQuestion =
      `Ollama could not plan this step (${reason}). Use OpenAI for this task only?`.slice(0, 1_000);
    task.status = task.status === 'planning' ? 'waiting_for_user' : transition(task.status, 'ask');
    this.#broadcast();
    return true;
  }

  #providerOverride(task: Task): 'openai' | 'ollama' | undefined {
    if (this.deps.subscriptionText?.() && !task.useOpenAI) return undefined;
    return task.useOpenAI ? 'openai' : task.provider;
  }

  #export(task: Task, format: 'csv' | 'xlsx'): void {
    const fields = task.records.fields.length
      ? task.records.fields
      : [...new Set(task.records.list().flatMap((record) => Object.keys(record.fields)))];
    const bytes =
      format === 'csv'
        ? new TextEncoder().encode(toCsv(fields, task.records.list()))
        : toXlsx(fields, task.records.list());
    this.#recordsKey += 1;
    const filename = `nudge-records-${this.#recordsKey}.${format}`;
    task.exports.push(filename);
    this.deps.emit({
      type: 'export_ready',
      format,
      filename,
      dataBase64: base64(bytes),
      mime:
        format === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  #set(event: TaskEvent): void {
    const task = this.#task;
    if (!task) return;
    task.status = transition(task.status, event);
    this.#broadcast();
  }

  #timeline(
    task: Task,
    id: string,
    label: string,
    status: TimelineStep['status'],
    detail?: string,
  ): void {
    const key = `${task.id}:${id}`.slice(0, 120);
    const previous = task.timeline.find((item) => item.id === key);
    const now = this.deps.clock();
    const step: TimelineStep = {
      id: key,
      startedAt: previous?.startedAt ?? now,
      ...(['completed', 'error'].includes(status) ? { completedAt: now } : {}),
      label: label.slice(0, 500) || 'Step',
      status,
      ...(detail ? { detail: detail.slice(0, 2_000) } : {}),
    };
    task.timeline = [...task.timeline.filter((item) => item.id !== step.id), step].slice(-100);
  }

  async #checkpoint(task: Task, inFlight?: { tool: string; fingerprint: string }): Promise<void> {
    if (isTerminal(task.status)) return;
    await this.deps.checkpoints
      .save(
        toCheckpoint({
          taskId: task.id,
          memory: task.memory,
          status: task.status,
          authorization: task.authorization,
          records: task.records.list(),
          generation: this.#scheduler.generation,
          instructionVersion: this.#scheduler.instructionVersion,
          inFlight,
          boundTabId: task.boundTabId,
          provider: this.#providerOverride(task),
        }),
      )
      .catch(() => undefined);
  }

  #noteSpreadsheetEdit(task: Task, call: { tool: string }, accepted: boolean): void {
    if (call.tool !== 'type_text' || !isSpreadsheet(task.snapshot)) return;
    task.notes.push(
      accepted
        ? 'That edit changed only the active spreadsheet cell. Next, press_keys Tab for the next column or Enter for the next row before typing again.'
        : 'The spreadsheet editor rejected another edit of this cell. Press Escape, then press_keys Tab or Enter to leave it. Do not type into the same cell again.',
    );
  }

  #broadcast(): void {
    this.deps.emit({ type: 'state', task: this.snapshot() });
  }
}

function isSpreadsheet(snapshot: Pick<PageSnapshot, 'url' | 'elements'> | undefined): boolean {
  if (!snapshot) return false;
  try {
    const url = new URL(snapshot.url);
    if (url.hostname === 'docs.google.com' && url.pathname.startsWith('/spreadsheets')) return true;
    if (url.hostname === 'excel.office.com') return true;
    if (url.hostname.endsWith('.office.com') && /\/excel/i.test(url.pathname)) return true;
  } catch {
    /* The page address is not a URL. */
  }
  return snapshot.elements.some(
    (element) => element.kind === 'gridcell' || element.role === 'grid' || element.role === 'gridcell',
  );
}

function spreadsheetCue(snapshot: PageSnapshot | undefined): string | undefined {
  if (!isSpreadsheet(snapshot)) return;
  return 'Spreadsheet: type a value into the active cell once, then press_keys Tab to the next column or Enter to the next row. Fill across the row before moving down. The name box (a reference like A1) only selects a cell; do not type data into it. If the cell already shows the value, do not type it again.';
}
