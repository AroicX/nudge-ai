import { describe, expect, it } from 'vitest';

import { InvalidTransitionError, transition } from './task-machine';

describe('transition', () => {
  it('moves running → waiting_for_confirmation → running on confirmed', () => {
    const waiting = transition('running', 'need_confirm');
    expect(waiting).toBe('waiting_for_confirmation');
    expect(transition(waiting, 'confirmed')).toBe('running');
  });

  it('cancels from any non-terminal state', () => {
    for (const state of ['planning', 'running', 'waiting_for_page', 'waiting_for_user', 'waiting_for_confirmation', 'paused'] as const) {
      expect(transition(state, 'cancel')).toBe('cancelled');
    }
  });

  it('rejects events in terminal states', () => {
    expect(() => transition('completed', 'resume')).toThrow(InvalidTransitionError);
    expect(() => transition('cancelled', 'execute')).toThrow(InvalidTransitionError);
  });

  it('pauses on budget and resumes to running', () => {
    const paused = transition('running', 'budget_reached');
    expect(paused).toBe('paused');
    expect(transition(paused, 'resume')).toBe('running');
  });

  it('waits for the user and continues when answered', () => {
    expect(transition(transition('running', 'ask'), 'answered')).toBe('running');
  });
});
