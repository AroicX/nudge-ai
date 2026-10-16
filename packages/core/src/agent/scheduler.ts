export interface Ticket {
  generation: number;
  instructionVersion: number;
}

export type ScheduleResult<T> = { status: 'done'; value: T } | { status: 'superseded' } | { status: 'uncertain' };

export const DEFAULT_BUDGET = { maxCalls: 60, maxMs: 900_000 } as const;

/**
 * The only path to page mutation for a task. Runs one item at a time; a stop
 * or correction bumps the generation so queued items never run and in-flight
 * results are reported as uncertain instead of being trusted or retried.
 */
export class ActionScheduler {
  #generation = 0;
  #instructionVersion = 0;
  #tail: Promise<unknown> = Promise.resolve();
  #calls = 0;
  #startedAt: number;
  #lastFingerprint: string | undefined;
  #repeats = 0;

  constructor(private readonly clock: () => number = Date.now) {
    this.#startedAt = clock();
  }

  get generation(): number {
    return this.#generation;
  }

  get instructionVersion(): number {
    return this.#instructionVersion;
  }

  get ticket(): Ticket {
    return { generation: this.#generation, instructionVersion: this.#instructionVersion };
  }

  get budget(): { calls: number; startedAt: number } {
    return { calls: this.#calls, startedAt: this.#startedAt };
  }

  bumpGeneration(): number {
    this.#generation += 1;
    return this.#generation;
  }

  bumpInstruction(): number {
    this.#instructionVersion += 1;
    this.#generation += 1;
    return this.#instructionVersion;
  }

  isCurrent(ticket: Ticket): boolean {
    return ticket.generation === this.#generation && ticket.instructionVersion === this.#instructionVersion;
  }

  run<T>(item: { fingerprint: string }, fn: (ticket: Ticket) => Promise<T>): Promise<ScheduleResult<T>> {
    const ticket = this.ticket;
    const result = this.#tail.then(async (): Promise<ScheduleResult<T>> => {
      if (!this.isCurrent(ticket)) return { status: 'superseded' };
      this.#calls += 1;
      if (item.fingerprint === this.#lastFingerprint) this.#repeats += 1;
      else {
        this.#lastFingerprint = item.fingerprint;
        this.#repeats = 1;
      }
      try {
        const value = await fn(ticket);
        return this.isCurrent(ticket) ? { status: 'done', value } : { status: 'uncertain' };
      } catch (error) {
        if (!this.isCurrent(ticket)) return { status: 'uncertain' };
        throw error;
      }
    });
    this.#tail = result.catch(() => undefined);
    return result;
  }

  budgetExceeded(limits: { maxCalls: number; maxMs: number } = DEFAULT_BUDGET): boolean {
    return this.#calls >= limits.maxCalls || this.clock() - this.#startedAt >= limits.maxMs;
  }

  resetBudget(): void {
    this.#calls = 0;
    this.#startedAt = this.clock();
  }

  repeatCount(fingerprint: string): number {
    return fingerprint === this.#lastFingerprint ? this.#repeats : 0;
  }

  noteProgress(): void {
    this.#lastFingerprint = undefined;
    this.#repeats = 0;
  }
}
