import {
  MUTATING_TOOLS,
  VISUAL_TOOLS,
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

import type { CdpPort, CheckpointPort, ContentPort, PlannerPort, ScreenshotPort, TabsPort } from './ports';

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
  capabilities: () => { vision: boolean };
  id?: () => string;
  limits?: { maxCalls: number; maxMs: number };
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
  confirmation?: Confirmation | undefined;
  pendingQuestion?: string | undefined;
  fallbackOffer?: { reason: string } | undefined;
  useOpenAI: boolean;
  report?: FinalReport | undefined;
  timeline: TimelineStep[];
  notes: string[];
  lastResult?: PlannerRequest['lastResult'];
  repeatNotes: number;
  timedRepeatId?: string | undefined;
  observedUrls: Set<string>;
  userTypedUrls: string[];
  skipped: Array<{ item: string; reason: string }>;
  exports: string[];
  capabilityLost: boolean;
  stepCount: number;
  unsubscribe: Array<() => void>;
}

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
  const target = 'elementId' in call && call.elementId ? snapshot?.elements.find((element) => element.id === call.elementId) : undefined;
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

  constructor(private readonly deps: ControllerDeps) {}

  // ───────────────────────── public surface ─────────────────────────

  snapshot(): ControllerSnapshot {
    const task = this.#task;
    if (!task) {
      return { status: 'idle', plan: [], memorySummary: { recordCount: 0, issues: [] }, capability: this.#capability, timeline: [] };
    }
    return {
      taskId: task.id,
      status: task.status,
      goal: task.memory.goal,
      plan: task.memory.plan,
      memorySummary: { recordCount: task.records.list().length, issues: task.memory.issues },
      ...(task.pendingPreview ? { pendingPreview: task.pendingPreview } : {}),
      ...(task.pendingQuestion ? { pendingQuestion: task.pendingQuestion } : {}),
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

  async instruct(text: string, source: 'text' | 'voice', originTabId?: number): Promise<void> {
    const task = this.#task;
    const active = task && !isTerminal(task.status);
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
          task.memory.plan.map((item) => (item.status === 'active' ? { ...item, status: 'skipped' } : item)),
        );
        task.notes.push(`User (${source}) asked to skip the current item; move on to the next one.`);
        this.#resumeIfWaiting();
        return;
      case 'confirm':
        if (task.pendingPreview) this.confirm(task.pendingPreview.previewId, classified.approved);
        return;
      case 'tab_correction':
        await this.#tabCorrection(classified.tabId, classified.text);
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
    if (!task || task.status !== 'waiting_for_confirmation' || task.pendingPreview?.previewId !== previewId) return;
    const preview = task.pendingPreview;
    task.pendingPreview = undefined;
    if (approved) {
      task.confirmation = bindConfirmation(preview, this.#scheduler.generation);
      task.notes.push(`User confirmed: ${preview.operation} (${preview.count} items). Proceed with exactly that operation.`);
      this.#set('confirmed');
    } else {
      task.confirmation = undefined;
      task.skipped.push({ item: preview.operation, reason: 'You declined the preview.' });
      task.notes.push(`User declined: ${preview.operation}. Do not perform it; continue or report what remains.`);
      this.#set('declined');
    }
    task.snapshotFresh = false;
    this.#kick();
  }

  answer(text: string): void {
    const task = this.#task;
    if (!task || task.status !== 'waiting_for_user') return;
    task.pendingQuestion = undefined;
    task.memory = addConstraint(task.memory, `User answered: ${text}`, this.#scheduler.instructionVersion);
    task.authorization = extendAuthorization(task.authorization, text);
    task.notes.push(`User answered: ${text}`);
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
      void this.#finishTask('failed', 'OpenAI fallback was not approved, so the task stopped before acting.');
      return;
    }
    task.useOpenAI = true;
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
    const records = RecordStore.from({ fields: checkpoint.memory.recordFields, records: checkpoint.records });
    this.#scheduler = new ActionScheduler(this.deps.clock);
    this.#task = this.#newTask({
      id: checkpoint.taskId,
      instruction: checkpoint.authorization.instruction,
      memory: restored.memory,
      authorization: checkpoint.authorization,
      records,
      boundTabId: checkpoint.boundTabId ?? checkpoint.memory.tabs.find((tab) => tab.role === 'origin')?.tabId ?? 0,
      status: 'paused',
    });
    this.#task.notes.push('Nudge restarted. Re-check the page; do not repeat an action whose outcome is uncertain without verifying it first.');
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
  }): Task {
    return {
      ...input,
      boundTabClosed: false,
      tabs: [],
      snapshotFresh: false,
      wantScreenshot: false,
      useOpenAI: false,
      timeline: [],
      notes: [],
      repeatNotes: 0,
      observedUrls: new Set(),
      userTypedUrls: input.instruction.match(URL_IN_TEXT) ?? [],
      skipped: [],
      exports: [],
      capabilityLost: false,
      stepCount: 0,
      unsubscribe: [],
    };
  }

  async #start(instruction: string, originTabId?: number): Promise<void> {
    if (this.#task) this.#teardown(this.#task);
    await this.idle();
    const id = this.deps.id?.() ?? `task_${crypto.randomUUID()}`;
    this.#scheduler = new ActionScheduler(this.deps.clock);
    const tabs = await this.deps.tabs.list();
    const origin = tabs.find((tab) => tab.tabId === originTabId) ?? tabs.find((tab) => tab.active) ?? tabs[0];
    const placeholder: AuthorizationRecord = { taskId: id, instruction, origins: [], categories: ['read', 'navigate'], destinations: [], exclusions: [], limits: {} };
    const task = this.#newTask({
      id,
      instruction,
      memory: createMemory(instruction),
      authorization: placeholder,
      records: new RecordStore([]),
      boundTabId: origin?.tabId ?? 0,
      status: 'planning',
    });
    task.tabs = tabs;
    this.#task = task;
    this.#watchTabs(task);
    this.#timeline(task, 'scope', 'Understanding your request', 'active');
    this.#broadcast();
    if (!origin) {
      await this.#finishTask('failed', 'There is no ordinary web page open for Nudge to work in.');
      return;
    }
    task.memory = setTabRole(task.memory, origin, 'origin');
    const abort = new AbortController();
    this.#planAbort = abort;
    try {
      const scope = await this.deps.planner.scope(
        { requestId: crypto.randomUUID(), instruction, tabs: tabs.map(({ tabId, title, url }) => ({ tabId, title, url })) },
        abort.signal,
        this.#providerOverride(task),
      );
      if (this.#task !== task || isTerminal(task.status)) return;
      task.authorization = sanitizeAuthorization(scope.proposal, instruction, id);
      task.memory = { ...task.memory, goal: scope.goal, recordFields: scope.recordFields ?? [] };
      task.records = new RecordStore(scope.recordFields ?? []);
      this.#timeline(task, 'scope', 'Understood the request', 'completed');
      this.#set('plan_ready');
      await this.#checkpoint(task);
      this.#kick();
    } catch (error) {
      if (this.#task !== task || isTerminal(task.status)) return;
      if (this.#offerFallback(task, error)) return;
      await this.#finishTask('failed', error instanceof Error ? error.message : 'Nudge could not understand the request.');
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
            void this.#finishTask('completed', 'The tab was closed, so the repeated action stopped.');
          }
        }
      }),
      this.deps.tabs.onUpdated((tabId, info) => {
        if (this.#task !== task || tabId !== task.boundTabId || !info.url || !task.timedRepeatId) return;
        try {
          const origin = new URL(info.url).origin;
          const original = task.memory.tabs.find((tab) => tab.tabId === tabId)?.origin;
          if (original && origin !== original) {
            void this.#stopTimed(task).then(() => this.#finishTask('completed', 'The page navigated away, so the repeated action stopped.'));
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
    this.#scheduler.bumpGeneration();
    this.#planAbort?.abort();
    await this.#stopTimed(task);
    await this.#finishTask('cancelled', summary);
  }

  async #stopTimed(task: Task): Promise<void> {
    if (!task.timedRepeatId) return;
    const repeatId = task.timedRepeatId;
    task.timedRepeatId = undefined;
    await this.deps.content.send(task.boundTabId, { type: 'timed_stop', repeatId }).catch(() => undefined);
  }

  async #finishTask(outcome: FinalReport['outcome'], summary: string): Promise<void> {
    const task = this.#task;
    if (!task || isTerminal(task.status)) return;
    this.deps.otp.cancelAll();
    await this.deps.cdp?.detach().catch(() => undefined);
    const report = buildReport(task.memory, task.records.list(), outcome, summary, task.exports);
    report.skipped = [...report.skipped, ...task.skipped].slice(-100);
    if (outcome === 'partially_completed') {
      report.partial = [...report.partial, ...task.memory.issues.filter((issue) => /could not|inaccessible/i.test(issue))].slice(-100);
    }
    task.report = report;
    task.pendingPreview = undefined;
    task.pendingQuestion = undefined;
    const event: TaskEvent = { completed: 'finish', partially_completed: 'partial', failed: 'fail', cancelled: 'cancel' }[outcome] as TaskEvent;
    task.status = transition(task.status, event);
    this.#timeline(task, 'final', summary, outcome === 'failed' ? 'error' : 'completed');
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
          await this.#finishTask('failed', error instanceof Error ? error.message : 'Nudge hit an unexpected error.');
        }
      } finally {
        this.#loop = undefined;
      }
    })();
  }

  async #iterate(task: Task): Promise<void> {
    if (this.#scheduler.budgetExceeded(this.deps.limits ?? DEFAULT_BUDGET)) {
      this.#set('budget_reached');
      this.deps.emit({ type: 'milestone', text: 'I reached this run’s step budget. Say continue to keep going.' });
      return;
    }
    const ticket = this.#scheduler.ticket;
    task.tabs = await this.deps.tabs.list();
    if (task.boundTabClosed || !task.tabs.some((tab) => tab.tabId === task.boundTabId)) {
      this.#askUser(task, 'The tab I was working in was closed. Which tab should I use?');
      return;
    }

    const observation = await this.#observe(task);
    if (!this.#scheduler.isCurrent(ticket) || task.status !== 'running') return;

    const request = this.#plannerRequest(task, observation);
    task.notes = [];
    task.lastResult = undefined;
    let response: PlannerResponse;
    const abort = new AbortController();
    this.#planAbort = abort;
    this.#timeline(task, `plan_${task.stepCount}`, 'Choosing the next step', 'active');
    try {
      response = await this.deps.planner.plan(request, abort.signal, this.#providerOverride(task));
    } catch (error) {
      if (!this.#scheduler.isCurrent(ticket) || task.status !== 'running') return;
      if (this.#offerFallback(task, error)) return;
      throw error;
    }
    if (!this.#scheduler.isCurrent(ticket) || task.status !== 'running') {
      this.#timeline(task, `plan_${task.stepCount}`, 'Discarded a step planned before your change', 'completed');
      return;
    }
    task.stepCount += 1;
    if (response.planUpdate) {
      const before = task.memory.plan;
      task.memory = applyPlanUpdate(task.memory, response.planUpdate);
      for (const item of response.planUpdate) {
        const previous = before.find((candidate) => candidate.id === item.id);
        if (item.status === 'done' && previous?.status !== 'done') this.deps.emit({ type: 'milestone', text: item.text });
      }
    }
    await this.#dispatch(task, response, observation);
    await this.#checkpoint(task);
    this.#broadcast();
  }

  async #observe(task: Task): Promise<Observation | null> {
    if (!task.snapshotFresh || !task.snapshot) {
      const result = await this.deps.content.send(task.boundTabId, { type: 'observe' });
      if (!result.snapshot) throw new Error('Nudge could not read the page.');
      this.#noteSnapshot(task, result.snapshot);
    }
    task.snapshotFresh = false;
    const snapshot = task.snapshot!;
    let screenshot: Observation['screenshot'];
    if (task.wantScreenshot) {
      task.wantScreenshot = false;
      if (!this.deps.capabilities().vision) {
        task.notes.push('Screenshots are unavailable: the selected model cannot see images. Use DOM tools or report the limitation.');
      } else {
        try {
          screenshot = await this.deps.screenshots.capture(task.boundTabId, snapshot);
          task.frame = screenshot.frame;
        } catch (error) {
          task.notes.push(`Screenshot failed: ${error instanceof Error ? error.message : 'unknown error'}.`);
        }
      }
    }
    return { tabId: task.boundTabId, snapshot, ...(screenshot ? { screenshot } : {}) };
  }

  #noteSnapshot(task: Task, snapshot: PageSnapshot): void {
    task.snapshot = snapshot;
    for (const element of snapshot.elements) if (element.href) task.observedUrls.add(element.href);
    task.observedUrls.add(snapshot.url);
    if (snapshot.inaccessible.includes('canvas')) {
      task.memory = addIssue(task.memory, 'Part of this page is a canvas that could not be read as page structure.');
    }
  }

  #plannerRequest(task: Task, observation: Observation | null): PlannerRequest {
    const records = task.records.list();
    const notes = [...task.notes];
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
      capabilities: { vision: this.deps.capabilities().vision, trustedInput: this.#capability === 'dom_plus_trusted_input' },
      notes: notes.map((note) => note.slice(0, 1_000)).slice(-20),
    };
  }

  // ───────────────────────── dispatch ─────────────────────────

  async #dispatch(task: Task, response: PlannerResponse, observation: Observation | null): Promise<void> {
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
        const result = await this.deps.content.send(task.boundTabId, { type: 'execute', call, documentId: task.snapshot!.documentId, generation: this.#scheduler.generation });
        const detail = result.text ? `Text (untrusted): ${result.text.slice(0, 1_800)}` : result.detail;
        task.lastResult = { tool: call.tool, ok: result.ok, detail: detail.slice(0, 2_000) };
        return;
      }
      case 'ask_user':
        this.#askUser(task, call.question);
        return;
      case 'request_confirmation':
        this.#preview(task, call.preview, observation?.snapshot);
        return;
      case 'record_items': {
        const snapshot = task.snapshot;
        const evidence = {
          texts: [...(snapshot?.text ?? []), ...(snapshot?.elements ?? []).flatMap((element) => [element.name ?? '', element.text ?? ''])],
          hrefs: [...task.observedUrls],
          values: (snapshot?.elements ?? []).flatMap((element) => (element.value ? [element.value] : [])),
        };
        let added = 0;
        let unknown = 0;
        for (const record of call.records) {
          const outcome = task.records.add(
            { fields: recordFieldsToObject(record.fields), sourceUrl: record.sourceUrl, observedAt: new Date(this.deps.clock()).toISOString() },
            evidence,
          );
          if (outcome.added) added += 1;
          unknown += Object.values(outcome.record.fields).filter((value) => value === 'unknown').length;
          if (snapshot) task.memory = addSource(task.memory, snapshot.url);
        }
        task.memory = { ...task.memory, recordCount: task.records.list().length };
        task.memory = appendStep(task.memory, { tool: call.tool, summary: `Recorded ${added} new items (${call.records.length - added} duplicates)`, ok: true, evidence: `${unknown} fields not shown on the page were stored as unknown` });
        task.lastResult = { tool: call.tool, ok: true, detail: `Recorded ${added} new, ${call.records.length - added} duplicates; ${unknown} unsupported fields stored as unknown.` };
        this.#timeline(task, stepId, `Recorded ${added} items`, 'completed');
        return;
      }
      case 'export_records':
        this.#export(task, call.format);
        task.lastResult = { tool: call.tool, ok: true, detail: `Prepared ${call.format.toUpperCase()} download.` };
        return;
      case 'finish': {
        const pending = task.memory.plan.some((item) => item.status === 'pending' || item.status === 'active');
        const inaccessible = task.memory.issues.some((issue) => /could not be read/i.test(issue));
        if (task.snapshot) task.memory = addSource(task.memory, task.snapshot.url);
        task.memory = appendStep(task.memory, { tool: 'finish', summary: call.summary.slice(0, 1_000), ok: true, ...(call.evidence[0] ? { evidence: call.evidence.join('; ').slice(0, 1_000) } : {}) });
        await this.#finishTask(pending || inaccessible ? 'partially_completed' : 'completed', call.summary);
        return;
      }
      case 'report_partial': {
        task.memory = applyPlanUpdate(task.memory, [
          ...task.memory.plan.filter((item) => item.status !== 'pending' && item.status !== 'active'),
          ...call.remaining.map((text, index) => ({ id: `remaining_${index}`, text: text.slice(0, 500), status: 'pending' as const })),
        ]);
        task.memory = addIssue(task.memory, call.reason);
        await this.#finishTask(call.done.length || task.memory.steps.length ? 'partially_completed' : 'failed', call.reason);
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
        const valid = validateTimedRepeat(call, { authorization: task.authorization, tabOrigin: origin });
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
        task.memory = appendStep(task.memory, { tool: call.tool, summary: `Repeating every ${Math.round(call.intervalMs / 1000)} s until you say stop`, ok: true, evidence: 'Timer started in the page' });
        this.#timeline(task, stepId, `Repeating every ${Math.round(call.intervalMs / 1000)} seconds — say “stop” to end`, 'active');
        this.deps.emit({ type: 'milestone', text: `Repeating every ${Math.round(call.intervalMs / 1000)} seconds. Say stop when you want me to end.` });
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
        (element) => element.rect && call.x >= element.rect.x && call.x <= element.rect.x + element.rect.width && call.y >= element.rect.y && call.y <= element.rect.y + element.rect.height,
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
          recordValues: records.flatMap((record) => Object.values(record.fields)).filter((value) => value !== 'unknown'),
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
        currentFingerprint: this.#currentFingerprint(task),
        generation: this.#scheduler.generation,
        bulkCount: Math.max(1, selection(snapshot).length),
        visualTarget,
      },
      call,
    );
  }

  #currentFingerprint(task: Task): string | undefined {
    const selected = selection(task.snapshot);
    if (selected.length) return targetFingerprint(selected);
    return task.confirmation?.targetFingerprint;
  }

  #handlePolicy(task: Task, call: ToolCall, policy: PolicyOutcome, label: string): void {
    if (policy.decision === 'confirm') {
      const selected = selection(task.snapshot);
      this.#preview(
        task,
        {
          operation: label,
          location: task.snapshot?.title || task.snapshot?.url || 'this page',
          criteria: task.instruction.slice(0, 1_000),
          count: Math.max(1, selected.length),
          samples: selected.slice(0, 5),
          reversible: policy.category === 'move_reversible',
          permanent: policy.category === 'delete_permanent',
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
      task.memory = appendStep(task.memory, { tool: call.tool, summary: `${label} — not done: ${policy.reason}`.slice(0, 1_000), ok: false });
      this.#timeline(task, `blocked_${task.stepCount}`, `Skipped: ${label}`, 'error', policy.reason);
      const fingerprint = fingerprintOf(call);
      if (this.#scheduler.repeatCount(fingerprint) >= 2) this.#noteRepeat(task);
    }
  }

  #preview(task: Task, proposal: Omit<OperationPreview, 'previewId' | 'targetFingerprint'>, snapshot?: PageSnapshot): void {
    const selected = selection(snapshot);
    const preview: OperationPreview = {
      ...proposal,
      previewId: `preview_${crypto.randomUUID()}`,
      count: selected.length || proposal.count,
      samples: (selected.length ? selected : proposal.samples).slice(0, 5),
      targetFingerprint: selected.length ? targetFingerprint(selected) : targetFingerprint([...proposal.samples, `count:${proposal.count}`]),
    };
    task.pendingPreview = preview;
    task.confirmation = undefined;
    this.#set('need_confirm');
    this.#timeline(task, `preview_${task.stepCount}`, `Waiting for your OK: ${preview.operation} (${preview.count})`, 'active');
    this.deps.emit({ type: 'milestone', text: `Please confirm: ${preview.operation}, ${preview.count} item${preview.count === 1 ? '' : 's'}.` });
  }

  #askUser(task: Task, question: string): void {
    task.pendingQuestion = question.slice(0, 1_000);
    this.#set('ask');
    this.#timeline(task, `ask_${task.stepCount}`, question.slice(0, 500), 'active');
    this.deps.emit({ type: 'milestone', text: question.slice(0, 1_000) });
  }

  async #mutate(task: Task, call: ToolCall, response: PlannerResponse, label: string, stepId: string): Promise<void> {
    if (!MUTATING_TOOLS.has(call.tool)) {
      task.lastResult = { tool: call.tool, ok: false, detail: 'Unsupported tool.' };
      return;
    }
    if (call.tool === 'transfer_code') {
      const policy = this.#policy(task, call, response);
      if (policy.decision !== 'allow') return this.#handlePolicy(task, call, policy, label);
      return this.#transferCode(task, call, stepId);
    }
    const policy = this.#policy(task, call, response);
    if (policy.decision !== 'allow') return this.#handlePolicy(task, call, policy, label);

    if (VISUAL_TOOLS.has(call.tool) && !(await this.#ensureTrustedInput(task))) return;

    const fingerprint = fingerprintOf(call);
    const before = task.snapshot;
    this.#timeline(task, stepId, label, 'active');
    await this.#checkpoint(task, { tool: call.tool, fingerprint });
    const outcome = await this.#scheduler.run({ fingerprint }, () => this.#execute(task, call));
    if (outcome.status === 'superseded') {
      this.#timeline(task, stepId, `${label} — cancelled before it ran`, 'completed');
      return;
    }
    if (outcome.status === 'uncertain') {
      task.memory = appendStep(task.memory, { tool: call.tool, summary: `${label} — outcome uncertain (interrupted)`, ok: false, uncertain: true });
      task.memory = addIssue(task.memory, `Verify before continuing: ${label} may or may not have happened.`);
      this.#timeline(task, stepId, `${label} — interrupted`, 'error');
      await this.#checkpoint(task);
      return;
    }
    const result = outcome.value;
    if (!result.ok) {
      task.lastResult = { tool: call.tool, ok: false, detail: result.detail };
      task.memory = appendStep(task.memory, { tool: call.tool, summary: `${label} — failed: ${result.detail}`.slice(0, 1_000), ok: false });
      this.#timeline(task, stepId, label, 'error', result.detail);
      if (this.#scheduler.repeatCount(fingerprint) >= 3) this.#noteRepeat(task);
      return;
    }

    // Verify against a fresh observation.
    const after = await this.deps.content.send(task.boundTabId, { type: 'observe' }).catch(() => undefined);
    if (after?.snapshot) {
      this.#noteSnapshot(task, after.snapshot);
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
    if (verification.verified && call.tool === 'type_text') this.#markSavedRecords(task, call.text, call.elementId);
    if (verification.verified && VISUAL_TOOLS.has(call.tool)) {
      task.memory = { ...task.memory, issues: task.memory.issues.filter((issue) => !/could not be read/i.test(issue)) };
    }
    task.memory = appendStep(task.memory, {
      tool: call.tool,
      summary: label,
      ok: true,
      ...(verification.verified && verification.evidence ? { evidence: verification.evidence } : {}),
    });
    task.lastResult = {
      tool: call.tool,
      ok: true,
      detail: (verification.verified ? `Verified: ${verification.evidence}` : `Done, but not verified: ${verification.reason ?? ''}`).slice(0, 2_000),
    };
    this.#timeline(task, stepId, label, 'completed', verification.verified ? verification.evidence : undefined);
    if (call.tool === 'click' || call.tool === 'type_text') task.confirmation = task.confirmation && this.#currentFingerprint(task) === task.confirmation.targetFingerprint ? task.confirmation : undefined;
    if (this.#scheduler.repeatCount(fingerprint) >= 3) this.#noteRepeat(task);
  }

  async #execute(task: Task, call: ToolCall): Promise<ContentResult> {
    const documentId = task.snapshot?.documentId ?? '';
    const ok = (detail: string, changed = true): ContentResult => ({ ok: true, detail, changed, documentId });
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
        if (!task.memory.tabs.some((entry) => entry.tabId === tab.tabId)) task.memory = setTabRole(task.memory, tab, 'other');
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
        return this.deps.content.send(task.boundTabId, {
          type: 'execute',
          call: call as never,
          documentId,
          generation: this.#scheduler.generation,
        });
    }
  }

  async #executeVisual(task: Task, call: Extract<ToolCall, { tool: 'click_at' | 'double_click_at' | 'drag_at' | 'type_at' }>, documentId: string): Promise<ContentResult> {
    const cdp = this.deps.cdp!;
    if (cdp.attachedTabId() !== task.boundTabId) {
      try {
        await cdp.attach(task.boundTabId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Trusted input is unavailable.';
        this.#capability = 'dom_only';
        this.deps.emit({ type: 'need_capability', capability: 'trusted_input', reason: reason.slice(0, 1_000) });
        return { ok: false, detail: reason, changed: false, documentId };
      }
    }
    this.#capability = 'dom_plus_trusted_input';
    const point = call.tool === 'drag_at' ? call.from : { x: call.x, y: call.y };
    await this.deps.content.send(task.boundTabId, { type: 'cursor', x: point.x, y: point.y }).catch(() => undefined);
    if (call.tool === 'click_at') await cdp.click(call.x, call.y);
    if (call.tool === 'double_click_at') await cdp.click(call.x, call.y, { double: true });
    if (call.tool === 'type_at') {
      await cdp.click(call.x, call.y);
      await cdp.insertText(call.text);
    }
    if (call.tool === 'drag_at') {
      await cdp.drag(call.from, call.to);
      await this.deps.content.send(task.boundTabId, { type: 'cursor', x: call.to.x, y: call.to.y }).catch(() => undefined);
    }
    task.frame = undefined; // coordinates from this frame must not be reused after a trusted action
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: true, detail: 'Trusted input dispatched.', changed: true, documentId };
  }

  async #ensureTrustedInput(task: Task): Promise<boolean> {
    const cdp = this.deps.cdp;
    if (cdp && this.#capability === 'dom_plus_trusted_input' && (await cdp.available())) return true;
    if (cdp && (await cdp.available())) {
      this.#capability = 'dom_plus_trusted_input';
      return true;
    }
    task.capabilityLost = true;
    this.deps.emit({
      type: 'need_capability',
      capability: 'trusted_input',
      reason: 'This page needs real mouse and keyboard input (for example a canvas editor). Chrome will show a “started debugging this browser” bar while Nudge controls the tab.',
    });
    this.#askUser(task, 'This step needs real mouse and keyboard input. Allow Nudge to control this tab’s input, or tell me to stop.');
    return false;
  }

  async #transferCode(task: Task, call: Extract<ToolCall, { tool: 'transfer_code' }>, stepId: string): Promise<void> {
    const known = (id: number) => task.tabs.some((tab) => tab.tabId === id);
    if (!known(call.sourceTabId) || !known(call.destinationTabId)) {
      task.lastResult = { tool: call.tool, ok: false, detail: 'Source or destination tab is not available.' };
      return;
    }
    let destinationDocumentId = task.boundTabId === call.destinationTabId ? task.snapshot?.documentId : undefined;
    if (!destinationDocumentId) {
      destinationDocumentId = (await this.deps.content.send(call.destinationTabId, { type: 'observe' })).snapshot?.documentId;
    }
    if (!destinationDocumentId || !call.destinationElementId.startsWith(`${destinationDocumentId}:`)) {
      task.lastResult = { tool: call.tool, ok: false, detail: 'The destination field is from an older page; observe the destination tab again.' };
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
      task.memory = addIssue(task.memory, 'The code transfer was interrupted; check the verification field.');
      return;
    }
    task.memory = appendStep(task.memory, {
      tool: call.tool,
      summary: outcome.value.ok ? 'Entered the code into the verification field (not submitted)' : `Code not entered: ${outcome.value.detail}`,
      ok: outcome.value.ok,
      ...(outcome.value.ok ? { evidence: outcome.value.detail } : {}),
    });
    task.lastResult = { tool: call.tool, ok: outcome.value.ok, detail: outcome.value.detail };
    this.#timeline(task, stepId, outcome.value.ok ? 'Entered the code (not submitted)' : 'Could not enter the code', outcome.value.ok ? 'completed' : 'error');
  }

  // ───────────────────────── helpers ─────────────────────────

  /** A record counts as written once one of its values was typed into a destination and read back. */
  #markSavedRecords(task: Task, text: string, elementId: string): void {
    const value = text.trim().toLowerCase();
    if (!value) return;
    const target = task.snapshot?.elements.find((element) => element.id === elementId);
    for (const record of task.records.unsaved()) {
      const matches = Object.values(record.fields).some((field) => field !== 'unknown' && field.trim().toLowerCase() === value);
      if (!matches || record.sourceUrl === task.snapshot?.url) continue;
      task.records.markSaved(record.id, {
        tabId: task.boundTabId,
        rowHint: (target?.name ?? target?.label ?? elementId).slice(0, 200),
        verifiedAt: new Date(this.deps.clock()).toISOString(),
      });
    }
  }

  #noteRepeat(task: Task): void {
    task.repeatNotes += 1;
    task.notes.push('Repeated action without progress; choose a different approach or report what remains.');
    if (task.repeatNotes > 2) {
      void this.#finishTask('partially_completed', 'I kept trying the same step without progress, so I stopped here.');
    }
  }

  #correct(text: string, source: 'text' | 'voice'): void {
    const task = this.#task!;
    this.#scheduler.bumpInstruction();
    this.#planAbort?.abort();
    task.memory = addConstraint(task.memory, text, this.#scheduler.instructionVersion);
    task.authorization = extendAuthorization(task.authorization, text);
    task.notes.push(`User changed the instructions (${source}): ${text}`);
    task.confirmation = undefined;
    task.snapshotFresh = false;
    this.#timeline(task, `correction_${this.#scheduler.instructionVersion}`, `Updated: ${text}`.slice(0, 500), 'completed');
    if (task.status === 'waiting_for_confirmation') {
      task.pendingPreview = undefined;
      this.#set('declined');
    } else if (task.status === 'paused') this.#set('resume');
    this.#broadcast();
    this.#kick();
  }

  async #tabCorrection(tabId: number | undefined, text: string): Promise<void> {
    const task = this.#task!;
    task.tabs = await this.deps.tabs.list();
    const candidates = task.tabs.filter((tab) => tab.tabId !== task.boundTabId);
    const target = tabId ?? (candidates.length === 1 ? candidates[0]!.tabId : undefined);
    if (target === undefined) {
      if (task.status === 'running') this.#scheduler.bumpGeneration();
      this.#askUser(task, `Which tab should I use? ${candidates.map((tab) => `“${tab.title}”`).join(', ')}`.slice(0, 1_000));
      return;
    }
    this.#scheduler.bumpInstruction();
    this.#rebind(target);
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
  }

  #resumeIfWaiting(): void {
    const task = this.#task!;
    if (task.status === 'waiting_for_user') {
      task.pendingQuestion = undefined;
      this.#set('answered');
    }
    this.#kick();
  }

  #offerFallback(task: Task, error: unknown): boolean {
    if (this.deps.provider() !== 'ollama' || task.useOpenAI) return false;
    const reason = error instanceof Error ? error.message : 'Ollama could not complete this step.';
    task.fallbackOffer = { reason: reason.slice(0, 1_000) };
    task.pendingQuestion = `Ollama could not plan this step (${reason}). Use OpenAI for this task only?`.slice(0, 1_000);
    task.status = task.status === 'planning' ? 'waiting_for_user' : transition(task.status, 'ask');
    this.#broadcast();
    return true;
  }

  #providerOverride(task: Task): 'openai' | undefined {
    return task.useOpenAI ? 'openai' : undefined;
  }

  #export(task: Task, format: 'csv' | 'xlsx'): void {
    const fields = task.records.fields.length ? task.records.fields : [...new Set(task.records.list().flatMap((record) => Object.keys(record.fields)))];
    const bytes = format === 'csv' ? new TextEncoder().encode(toCsv(fields, task.records.list())) : toXlsx(fields, task.records.list());
    this.#recordsKey += 1;
    const filename = `nudge-records-${this.#recordsKey}.${format}`;
    task.exports.push(filename);
    this.deps.emit({
      type: 'export_ready',
      format,
      filename,
      dataBase64: base64(bytes),
      mime: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  #set(event: TaskEvent): void {
    const task = this.#task;
    if (!task) return;
    task.status = transition(task.status, event);
    this.#broadcast();
  }

  #timeline(task: Task, id: string, label: string, status: TimelineStep['status'], detail?: string): void {
    const step: TimelineStep = { id: `${task.id}:${id}`.slice(0, 120), label: label.slice(0, 500) || 'Step', status, ...(detail ? { detail: detail.slice(0, 2_000) } : {}) };
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
        }),
      )
      .catch(() => undefined);
  }

  #broadcast(): void {
    this.deps.emit({ type: 'state', task: this.snapshot() });
  }
}
