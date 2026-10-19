/**
 * Detects lack of progress: the same action repeatedly leaving the page state
 * unchanged, or many consecutive actions with no observable state change.
 * Callers use the verdict to change approach (refresh, wait, inspect) and,
 * when exhausted, to stop with a specific blocker instead of looping.
 */
export interface ProgressVerdict {
  /** Times this exact action left this exact page state unchanged. */
  sameActionNoChange: number;
  /** Consecutive actions (any) without a page-state change or verified outcome. */
  stalledSteps: number;
  /** The planner must not repeat this action on this state again. */
  forbidRepeat: boolean;
  /** Stop and report the blocker. */
  exhausted: boolean;
}

export const PROGRESS_LIMITS = { sameAction: 2, stalledSteps: 6 } as const;

export class ProgressMonitor {
  #noChange = new Map<string, number>();
  #stalled = 0;

  constructor(private readonly limits: { sameAction: number; stalledSteps: number } = PROGRESS_LIMITS) {}

  record(input: {
    fingerprint: string;
    beforeHash: string | undefined;
    afterHash: string | undefined;
    verified: boolean;
  }): ProgressVerdict {
    const changed =
      input.verified || !input.beforeHash || !input.afterHash || input.beforeHash !== input.afterHash;
    const key = `${input.fingerprint}|${input.beforeHash ?? ''}`;
    if (changed) {
      this.#stalled = 0;
      this.#noChange.delete(key);
      return { sameActionNoChange: 0, stalledSteps: 0, forbidRepeat: false, exhausted: false };
    }
    this.#stalled += 1;
    const count = (this.#noChange.get(key) ?? 0) + 1;
    this.#noChange.set(key, count);
    return {
      sameActionNoChange: count,
      stalledSteps: this.#stalled,
      forbidRepeat: count >= this.limits.sameAction,
      exhausted: count > this.limits.sameAction || this.#stalled >= this.limits.stalledSteps,
    };
  }

  /** True when this action already failed to change this exact state the allowed number of times. */
  isForbidden(fingerprint: string, stateHash: string | undefined): boolean {
    return (this.#noChange.get(`${fingerprint}|${stateHash ?? ''}`) ?? 0) >= this.limits.sameAction;
  }

  /** Any user correction or new instruction resets the stall counters. */
  reset(): void {
    this.#noChange.clear();
    this.#stalled = 0;
  }
}

/** FNV-1a hash used to fingerprint page state. */
export function stableHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
