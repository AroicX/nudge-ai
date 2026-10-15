import type { TaskState } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { reduceTask } from './reducer';

const baseTask: TaskState = {
  id: 'task_1',
  goal: 'Find an iPhone 16',
  intent: 'search',
  constraints: [{ key: 'model', value: 'iPhone 16', source: 'explicit' }],
  successConditions: ['Matching products are visible'],
  missingRequiredInformation: [],
  risk: 'low',
  status: 'active',
  cancellationGeneration: 0,
  verifiedActions: [],
  boundTabId: 7,
  boundDocumentId: 'doc_1',
};

describe('reduceTask', () => {
  it('starts with the supplied task state', () => {
    expect(reduceTask(null, { type: 'start', task: baseTask })).toEqual(baseTask);
  });

  it('retains existing constraints when a follow-up adds another constraint', () => {
    const result = reduceTask(baseTask, {
      type: 'modify',
      constraints: [{ key: 'colour', value: 'black', source: 'explicit' }],
      successConditions: ['Black matching products are visible'],
    });

    expect(result.constraints).toEqual([
      { key: 'model', value: 'iPhone 16', source: 'explicit' },
      { key: 'colour', value: 'black', source: 'explicit' },
    ]);
    expect(result.goal).toBe('Find an iPhone 16');
  });

  it('moves to waiting state for one missing clarification', () => {
    const result = reduceTask(baseTask, {
      type: 'clarify',
      missingRequiredInformation: ['recipient'],
    });

    expect(result.status).toBe('waiting_for_user');
    expect(result.missingRequiredInformation).toEqual(['recipient']);
  });

  it('increments the generation and stops immediately', () => {
    const result = reduceTask(baseTask, { type: 'stop' });

    expect(result.status).toBe('stopped');
    expect(result.cancellationGeneration).toBe(1);
  });

  it('resumes without losing the task goal or constraints', () => {
    const stopped = { ...baseTask, status: 'stopped' as const, cancellationGeneration: 1 };
    const result = reduceTask(stopped, { type: 'resume' });

    expect(result.status).toBe('active');
    expect(result.goal).toBe(baseTask.goal);
    expect(result.constraints).toEqual(baseTask.constraints);
    expect(result.cancellationGeneration).toBe(2);
  });

  it('updates document binding after navigation without replaying verified actions', () => {
    const result = reduceTask(baseTask, { type: 'document_changed', documentId: 'doc_2' });

    expect(result.boundDocumentId).toBe('doc_2');
    expect(result.verifiedActions).toEqual([]);
    expect(result.status).toBe('active');
  });
});
