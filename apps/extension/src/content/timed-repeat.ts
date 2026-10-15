import type { ContentRequest } from '@nudge/contracts';

type StartRequest = Extract<ContentRequest, { type: 'timed_start' }>;
export type TimedEndReason = 'stopped' | 'end_reached' | 'max_duration' | 'navigated';

export interface TimedRepeatDeps {
  scrollBy(x: number, y: number): void;
  metrics(): { scrollY: number; viewportHeight: number; pageHeight: number };
  now(): number;
  onEnd(repeatId: string, reason: TimedEndReason): void;
  addUnloadListener(listener: () => void): () => void;
  pressKey?: (key: string) => void;
}

/** Deterministic in-page repeat: no model calls per tick, cancelled synchronously. */
export class TimedRepeatRunner {
  #active: { id: string; timer: ReturnType<typeof setInterval>; removeUnload: () => void } | undefined;

  constructor(private readonly deps: TimedRepeatDeps) {}

  get activeId(): string | undefined {
    return this.#active?.id;
  }

  start(request: StartRequest): void {
    this.#finish('stopped');
    const startedAt = this.deps.now();
    const removeUnload = this.deps.addUnloadListener(() => this.#finish('navigated'));
    const timer = setInterval(() => {
      if (!this.#active || this.#active.id !== request.repeatId) return;
      if (this.deps.now() - startedAt >= request.maxDurationMs) {
        this.#finish('max_duration');
        return;
      }
      const { scrollY, viewportHeight, pageHeight } = this.deps.metrics();
      const atEnd = scrollY + viewportHeight >= pageHeight - 2;
      if (request.stopAtEnd && atEnd) {
        this.#finish('end_reached');
        return;
      }
      if (request.action.kind === 'scroll') {
        const amount = request.action.amount === 'viewport' ? viewportHeight * 0.8 : request.action.amount === 'end' ? pageHeight : request.action.amount;
        const sign = request.action.direction === 'up' || request.action.direction === 'left' ? -1 : 1;
        const vertical = request.action.direction === 'up' || request.action.direction === 'down';
        this.deps.scrollBy(vertical ? 0 : sign * amount, vertical ? sign * amount : 0);
      } else {
        for (const key of request.action.keys) this.deps.pressKey?.(key);
      }
      const after = this.deps.metrics();
      if (request.stopAtEnd && after.scrollY + after.viewportHeight >= after.pageHeight - 2) this.#finish('end_reached');
    }, request.intervalMs);
    this.#active = { id: request.repeatId, timer, removeUnload };
  }

  stop(repeatId?: string): boolean {
    if (!this.#active || (repeatId && this.#active.id !== repeatId)) return false;
    this.#finish('stopped');
    return true;
  }

  #finish(reason: TimedEndReason): void {
    const active = this.#active;
    if (!active) return;
    this.#active = undefined;
    clearInterval(active.timer);
    active.removeUnload();
    this.deps.onEnd(active.id, reason);
  }
}
