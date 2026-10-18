import {
  ScheduledTaskSchema,
  type ScheduledTask,
  type ControllerMessage,
  type ProviderSelection,
} from '@nudge/contracts';

const HELP =
  'To run a browser task later, say “in 10 minutes, check this page” or “tomorrow at 9:30 am, check this page”. Chrome and the Nudge server must be running. Calendar meeting requests can be made normally.';
export function parseDeferredTask(
  text: string,
  now: number,
):
  | { kind: 'ordinary' }
  | { kind: 'clarify' }
  | { kind: 'schedule'; instruction: string; runAt: number } {
  text = text.trim().replace(/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/i, '');
  const relative = text.trim().match(/^in\s+(\d+)\s+(minutes?|hours?)\s*[,;:]?\s+(.+)$/i);
  if (relative) {
    const minutes = Number(relative[1]) * (/hour/i.test(relative[2]!) ? 60 : 1);
    return minutes > 0 && minutes <= 30 * 24 * 60
      ? { kind: 'schedule', instruction: relative[3]!, runAt: now + minutes * 60000 }
      : { kind: 'clarify' };
  }
  const tomorrow = text
    .trim()
    .match(/^tomorrow at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[,;:]?\s+(.+)$/i);
  if (tomorrow) {
    const hour = Number(tomorrow[1]);
    const minute = Number(tomorrow[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return { kind: 'clarify' };
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours((hour % 12) + (tomorrow[3]!.toLowerCase() === 'pm' ? 12 : 0), minute, 0, 0);
    return { kind: 'schedule', instruction: tomorrow[4]!, runAt: date.getTime() };
  }
  if (
    /^(?:in\s+(?:\d|a\s|an\s|one\s|two\s|three\s|five\s|ten\s)|at\s+\d|tomorrow\b|later\b|next (?:week|month|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|schedule (?:a |this )?task\b|schedule this\b)/i.test(
      text.trim(),
    )
  )
    return { kind: 'clarify' };
  return { kind: 'ordinary' };
}
interface Deps {
  load(): Promise<unknown>;
  save(jobs: ScheduledTask[]): Promise<void>;
  alarm(id: string, when: number): Promise<void>;
  clearAlarm(id: string): Promise<void>;
  tabs: {
    list(): Promise<Array<{ tabId: number; url: string; title?: string }>>;
    open(url: string): Promise<{ tabId: number }>;
    waitForComplete(id: number, ms: number): Promise<void>;
  };
  provider(): 'openai' | 'ollama';
  selection?(): ProviderSelection;
  prepare?(selection: ProviderSelection): Promise<void>;
  snapshot(): { status: string; taskId?: string | undefined };
  start(input: {
    id: string;
    instruction: string;
    originTabId: number;
    provider: 'openai' | 'ollama';
    prepare?: () => Promise<void>;
  }): Promise<'started' | 'busy'>;
  emit(message: ControllerMessage): void;
  clock(): number;
  id?(): string;
}
const terminal = (status: string) =>
  ['idle', 'completed', 'partially_completed', 'failed', 'cancelled'].includes(status);
export class DeferredTasks {
  #jobs: ScheduledTask[] = [];
  #queue: Promise<unknown> = Promise.resolve();
  constructor(private deps: Deps) {}
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work);
    this.#queue = next.catch(() => undefined);
    return next;
  }
  snapshot(): ScheduledTask[] {
    return this.#jobs.map((job) => ({ ...job }));
  }
  async #save() {
    await this.deps.save(this.#jobs);
    this.deps.emit({ type: 'schedules', jobs: this.snapshot() });
  }
  restore() {
    return this.#serial(async () => {
      const data = await this.deps.load();
      this.#jobs = Array.isArray(data)
        ? data.slice(0, 50).flatMap((value) => {
            const result = ScheduledTaskSchema.safeParse(value);
            return result.success ? [result.data] : [];
          })
        : [];
      for (const job of this.#jobs) {
        if (job.status === 'running') {
          job.status = 'attention';
          job.detail =
            'Nudge restarted during this task. Check its outcome before continuing; it will not run again automatically.';
        }
        if (job.status === 'pending')
          await this.deps.alarm(job.id, Math.max(job.runAt, this.deps.clock() + 1000));
      }
      await this.#save();
    });
  }
  instruct(text: string, originTabId?: number): Promise<boolean> {
    return this.#serial(async () => {
      const parsed = parseDeferredTask(text, this.deps.clock());
      if (parsed.kind === 'ordinary') return false;
      const say = (message: string) => this.deps.emit({ type: 'milestone', text: message });
      if (parsed.kind === 'clarify') {
        say(HELP);
        return true;
      }
      const origin = (await this.deps.tabs.list()).find((tab) => tab.tabId === originTabId);
      if (!origin || !/^https?:\/\//i.test(origin.url)) {
        say('Open the website for this task first, then schedule it again.');
        return true;
      }
      if (
        this.#jobs.filter((job) => ['pending', 'running', 'attention'].includes(job.status))
          .length >= 20
      ) {
        say('You have 20 scheduled tasks. Cancel a pending task before adding another.');
        return true;
      }
      const job: ScheduledTask = {
        id: this.deps.id?.() ?? `scheduled_${crypto.randomUUID()}`,
        instruction: parsed.instruction,
        runAt: parsed.runAt,
        originTabId: origin.tabId,
        originUrl: origin.url,
        provider: this.deps.provider(),
        ...(this.deps.selection ? { providerSelection: this.deps.selection() } : {}),
        status: 'pending',
      };
      if (this.#jobs.length >= 50) {
        const expired = this.#jobs.findIndex((entry) =>
          ['completed', 'failed', 'cancelled'].includes(entry.status),
        );
        if (expired >= 0) this.#jobs.splice(expired, 1);
      }
      this.#jobs.push(job);
      await this.#save();
      try {
        await this.deps.alarm(job.id, job.runAt);
      } catch {
        job.status = 'failed';
        job.detail = 'Chrome could not set the task alarm. Please schedule it again.';
        await this.#save();
        return true;
      }
      say(
        `Scheduled for ${new Date(job.runAt).toLocaleString()}. Chrome and the Nudge server must be running. Tasks more than 15 minutes late will be marked missed.`,
      );
      return true;
    });
  }
  cancel(id: string) {
    return this.#serial(async () => {
      const job = this.#jobs.find((entry) => entry.id === id);
      if (!job) return;
      const current = this.deps.snapshot();
      const orphaned =
        job.status === 'attention' && (current.taskId !== job.id || terminal(current.status));
      if (job.status !== 'pending' && !orphaned) return;
      job.status = 'cancelled';
      await this.#save();
      await this.deps.clearAlarm(id);
    });
  }
  async manage(
    id: string,
    action: 'run' | 'delete' | 'update',
    changes: { instruction?: string; runAt?: number } = {},
  ) {
    await this.#serial(async () => {
      const job = this.#jobs.find((entry) => entry.id === id);
      if (!job) throw new Error('This scheduled task no longer exists.');
      const current = this.deps.snapshot();
      if (
        job.status === 'running' ||
        (job.status === 'attention' && current.taskId === id && !terminal(current.status))
      )
        throw new Error('Stop or finish this task before changing its schedule.');
      if (action === 'delete') {
        await this.deps.clearAlarm(id);
        this.#jobs = this.#jobs.filter((entry) => entry.id !== id);
        await this.#save();
        return;
      }
      if (job.status !== 'pending') throw new Error('Only pending tasks can be run or updated.');
      if (action === 'run' && !terminal(current.status))
        throw new Error('Finish or stop the current browser task first.');
      const runAt = action === 'run' ? this.deps.clock() : changes.runAt;
      if (runAt === undefined || (action === 'update' && runAt <= this.deps.clock()))
        throw new Error('Choose a future execution time.');
      const updated = {
        ...job,
        runAt,
        ...(changes.instruction ? { instruction: changes.instruction } : {}),
        detail: undefined,
      };
      await this.deps.alarm(id, runAt);
      Object.assign(job, updated);
      await this.#save();
    });
    if (action === 'run') await this.runDue();
  }
  observe(task: {
    taskId?: string | undefined;
    status: string;
    report?: { summary: string } | undefined;
  }) {
    return this.#serial(async () => {
      const job = this.#jobs.find(
        (entry) => entry.id === task.taskId && ['running', 'attention'].includes(entry.status),
      );
      if (job) {
        job.status = terminal(task.status)
          ? task.status === 'completed'
            ? 'completed'
            : 'failed'
          : ['paused', 'waiting_for_user', 'waiting_for_confirmation'].includes(task.status)
            ? 'attention'
            : 'running';
        job.detail =
          job.status === 'attention'
            ? 'Open the task conversation to continue.'
            : task.report?.summary.slice(0, 1000);
        await this.#save();
      }
    });
  }
  runDue(now = this.deps.clock()) {
    return this.#serial(async () => {
      for (const job of this.#jobs
        .filter((entry) => entry.status === 'pending' && entry.runAt <= now)
        .sort((a, b) => a.runAt - b.runAt)) {
        if (now - job.runAt > 15 * 60000) {
          job.status = 'failed';
          job.detail =
            'Missed: this task was more than 15 minutes late. Schedule it again if still needed.';
          await this.#save();
          continue;
        }
        if (!terminal(this.deps.snapshot().status)) {
          job.detail = 'Waiting for the current task to finish.';
          await this.#save();
          await this.deps.alarm(job.id, now + 60000);
          continue;
        }
        job.status = 'running';
        job.detail = undefined;
        await this.#save();
        try {
          const tabs = await this.deps.tabs.list();
          const tab = tabs.find(
            (entry) => entry.tabId === job.originTabId && entry.url === job.originUrl,
          );
          const tabId = tab?.tabId ?? (await this.deps.tabs.open(job.originUrl)).tabId;
          if (!tab) await this.deps.tabs.waitForComplete(tabId, 15000);
          const result = await this.deps.start({
            id: job.id,
            instruction: job.instruction,
            originTabId: tabId,
            provider: job.provider,
            ...(this.deps.prepare
              ? {
                  prepare: async () => {
                    if (!job.providerSelection)
                      throw new Error(
                        'Saved provider settings are missing. Please schedule this task again.',
                      );
                    await this.deps.prepare!(job.providerSelection);
                  },
                }
              : {}),
          });
          if (result === 'busy') {
            job.status = 'pending';
            await this.deps.alarm(job.id, now + 60000);
          }
        } catch (error) {
          job.status = 'failed';
          job.detail = (
            error instanceof Error ? error.message : 'Could not start the scheduled task.'
          ).slice(0, 1000);
        }
        await this.#save();
      }
    });
  }
}
