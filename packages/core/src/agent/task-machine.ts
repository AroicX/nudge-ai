import type { TaskStatus } from '@nudge/contracts';

export type TaskEvent =
  | 'plan_ready'
  | 'execute'
  | 'await_page'
  | 'page_ready'
  | 'ask'
  | 'answered'
  | 'need_confirm'
  | 'confirmed'
  | 'declined'
  | 'pause'
  | 'resume'
  | 'budget_reached'
  | 'finish'
  | 'partial'
  | 'fail'
  | 'cancel';

export class InvalidTransitionError extends Error {
  constructor(from: TaskStatus, event: TaskEvent) {
    super(`Cannot apply ${event} while ${from}.`);
    this.name = 'InvalidTransitionError';
  }
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'partially_completed', 'failed', 'cancelled']);

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

const TABLE: Partial<Record<TaskStatus, Partial<Record<TaskEvent, TaskStatus>>>> = {
  planning: { plan_ready: 'running', ask: 'waiting_for_user' },
  running: {
    execute: 'running',
    await_page: 'waiting_for_page',
    ask: 'waiting_for_user',
    need_confirm: 'waiting_for_confirmation',
    budget_reached: 'paused',
  },
  waiting_for_page: { page_ready: 'running', ask: 'waiting_for_user' },
  waiting_for_user: { answered: 'running' },
  waiting_for_confirmation: { confirmed: 'running', declined: 'running' },
  paused: { resume: 'running' },
};

const FROM_ANY_ACTIVE: Partial<Record<TaskEvent, TaskStatus>> = {
  pause: 'paused',
  finish: 'completed',
  partial: 'partially_completed',
  fail: 'failed',
  cancel: 'cancelled',
};

export function transition(from: TaskStatus, event: TaskEvent): TaskStatus {
  if (isTerminal(from)) throw new InvalidTransitionError(from, event);
  const next = TABLE[from]?.[event] ?? FROM_ANY_ACTIVE[event];
  if (!next) throw new InvalidTransitionError(from, event);
  return next;
}
