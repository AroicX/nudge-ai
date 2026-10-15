import type { AgentStepResponse, PageSnapshot, TaskState } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { runTask } from './run-task';

const page = (snapshotId: string): PageSnapshot => ({
  snapshotId,
  documentId: 'doc-1',
  capturedAt: new Date().toISOString(),
  url: 'https://shop.example/',
  title: 'Shop',
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, pageHeight: 900 },
  elements: [{ id: 'doc-1:1', kind: 'button', name: 'Search', visible: true, disabled: false }],
  text: ['Shop'],
  truncated: false,
  inaccessible: [],
});

const task: TaskState = {
  id: 'task-1',
  goal: 'search',
  intent: 'search',
  constraints: [],
  successConditions: ['results'],
  missingRequiredInformation: [],
  risk: 'low',
  status: 'active',
  cancellationGeneration: 0,
  verifiedActions: [],
  boundTabId: 7,
  boundDocumentId: 'doc-1',
};

describe('runTask', () => {
  it('re-observes after each mutation before asking for another decision', async () => {
    const order: string[] = [];
    const observe = vi.fn(async () => {
      order.push('observe');
      return page(`snap-${order.length}`);
    });
    const responses: AgentStepResponse[] = [
      {
        requestId: 'r1',
        task: { ...task, boundTabId: 0, boundDocumentId: 'model-invented-document' },
        decision: {
          type: 'act',
          taskId: 'task-1',
          action: { type: 'click', elementId: 'doc-1:1' },
          expectedOutcome: 'results',
          narration: 'Searching',
        },
      },
      {
        requestId: 'r2',
        task: { ...task, status: 'completed' },
        decision: {
          type: 'finish',
          taskId: 'task-1',
          message: 'Done',
          evidence: [{ kind: 'page_text', text: 'Shop' }],
        },
      },
    ];
    const step = vi.fn(async () => {
      order.push('step');
      return responses.shift()!;
    });
    const execute = vi.fn(async () => {
      order.push('execute');
      return {
        ok: true,
        actionType: 'click' as const,
        documentId: 'doc-1',
        changed: true,
        detail: 'clicked',
      };
    });

    const handle = runTask(
      { tabId: 7, utterance: 'search', conversation: [], task: null },
      { observe, step, execute },
    );
    await expect(handle.done).resolves.toMatchObject({ status: 'completed' });
    expect(order).toEqual(['observe', 'step', 'execute', 'observe', 'step']);
  });

  it('ignores a late provider response after Stop', async () => {
    let resolve!: (value: AgentStepResponse) => void;
    const step = vi.fn(
      () =>
        new Promise<AgentStepResponse>((done) => {
          resolve = done;
        }),
    );
    const execute = vi.fn();
    const handle = runTask(
      { tabId: 7, utterance: 'search', conversation: [], task: null },
      { observe: async () => page('snap-1'), step, execute },
    );
    await vi.waitFor(() => expect(step).toHaveBeenCalled());
    handle.stop();
    resolve({
      requestId: 'r1',
      task,
      decision: {
        type: 'act',
        taskId: 'task-1',
        action: { type: 'click', elementId: 'doc-1:1' },
        expectedOutcome: 'results',
      },
    });

    await expect(handle.done).resolves.toMatchObject({ status: 'stopped' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('emits deterministic timeline transitions without provider reasoning', async () => {
    const onTimelineStep = vi.fn();
    const handle = runTask(
      { tabId: 7, utterance: 'search', conversation: [], task: null },
      {
        observe: async () => page('snap-1'),
        step: async () => ({
          requestId: 'r1',
          task: { ...task, status: 'completed' },
          decision: {
            type: 'finish',
            taskId: 'task-1',
            message: 'Done',
            evidence: [{ kind: 'page_text', text: 'Shop' }],
          },
        }),
        execute: vi.fn(),
        onTimelineStep,
      },
    );
    await handle.done;
    expect(onTimelineStep.mock.calls.map(([step]) => step.status)).toEqual([
      'active',
      'completed',
      'active',
      'completed',
    ]);
    expect(JSON.stringify(onTimelineStep.mock.calls)).not.toMatch(/reasoning|thoughts/i);
  });
});
