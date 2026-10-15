import { describe, expect, it } from 'vitest';

import {
  AgentDecisionSchema,
  BrowserActionSchema,
  ExtensionMessageSchema,
  PageSnapshotSchema,
  TaskStateSchema,
} from './index';

const page = {
  snapshotId: 'snap_1',
  documentId: 'doc_1',
  capturedAt: '2026-10-15T18:00:00.000Z',
  url: 'https://shop.example.test/search?q=iphone',
  title: 'Phone shop',
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, pageHeight: 1800 },
  elements: [
    {
      id: 'doc_1:1',
      kind: 'button',
      role: 'button',
      name: 'Apply filters',
      text: 'Apply',
      visible: true,
      disabled: false,
    },
  ],
  text: ['iPhone 16', 'Black', '256 GB'],
  truncated: false,
  inaccessible: [],
} as const;

describe('PageSnapshotSchema', () => {
  it('accepts a bounded page snapshot with document-scoped element IDs', () => {
    expect(PageSnapshotSchema.parse(page).elements[0]?.id).toBe('doc_1:1');
  });

  it('rejects an element ID scoped to another document', () => {
    const result = PageSnapshotSchema.safeParse({
      ...page,
      elements: [{ ...page.elements[0], id: 'doc_other:1' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects snapshots larger than 250 elements', () => {
    const result = PageSnapshotSchema.safeParse({
      ...page,
      elements: Array.from({ length: 251 }, (_, index) => ({
        ...page.elements[0],
        id: `doc_1:${index + 1}`,
      })),
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown snapshot fields', () => {
    expect(PageSnapshotSchema.safeParse({ ...page, rawHtml: '<main>secret</main>' }).success).toBe(
      false,
    );
  });
});

describe('BrowserActionSchema', () => {
  it.each([
    { type: 'read_page' },
    { type: 'click', elementId: 'doc_1:1' },
    { type: 'type_text', elementId: 'doc_1:2', text: 'Ada', mode: 'replace' },
    { type: 'select_option', elementId: 'doc_1:3', value: 'black' },
    { type: 'scroll', direction: 'down', amount: 'viewport' },
    {
      type: 'navigate_to_observed_url',
      url: 'https://shop.example.test/contact',
      sourceElementId: 'doc_1:4',
    },
    { type: 'wait_for_change', timeoutMs: 1500 },
  ])('accepts the strict $type action', (action) => {
    expect(BrowserActionSchema.safeParse(action).success).toBe(true);
  });

  it('rejects executable JavaScript and unknown action fields', () => {
    expect(
      BrowserActionSchema.safeParse({
        type: 'click',
        elementId: 'doc_1:1',
        javascript: 'document.body.innerHTML = "owned"',
      }).success,
    ).toBe(false);
  });
});

describe('AgentDecisionSchema', () => {
  it('requires current evidence to finish', () => {
    const withoutEvidence = AgentDecisionSchema.safeParse({
      type: 'finish',
      taskId: 'task_1',
      message: 'Done',
      evidence: [],
    });
    const withEvidence = AgentDecisionSchema.safeParse({
      type: 'finish',
      taskId: 'task_1',
      message: 'The black 256 GB filter is selected.',
      evidence: [{ kind: 'element_state', elementId: 'doc_1:3', detail: 'Black selected' }],
    });

    expect(withoutEvidence.success).toBe(false);
    expect(withEvidence.success).toBe(true);
  });

  it('accepts ask_user separately from browser mutations', () => {
    expect(
      AgentDecisionSchema.safeParse({
        type: 'ask_user',
        taskId: 'task_1',
        question: 'Which recipient should I use?',
        missing: ['recipient'],
      }).success,
    ).toBe(true);
  });
});

describe('TaskStateSchema', () => {
  it('requires a non-negative integer cancellation generation', () => {
    const task = {
      id: 'task_1',
      goal: 'Find an iPhone 16',
      intent: 'search',
      constraints: [{ key: 'model', value: 'iPhone 16', source: 'explicit' }],
      successConditions: ['Matching results are visible'],
      missingRequiredInformation: [],
      risk: 'low',
      status: 'active',
      cancellationGeneration: 0,
      verifiedActions: [],
      boundTabId: 9,
      boundDocumentId: 'doc_1',
    };

    expect(TaskStateSchema.safeParse(task).success).toBe(true);
    expect(TaskStateSchema.safeParse({ ...task, cancellationGeneration: 0.5 }).success).toBe(false);
    expect(TaskStateSchema.safeParse({ ...task, cancellationGeneration: -1 }).success).toBe(false);
  });
});

describe('ExtensionMessageSchema', () => {
  it('rejects unknown message fields', () => {
    expect(
      ExtensionMessageSchema.safeParse({
        type: 'page.observe',
        requestId: 'req_1',
        taskId: 'task_1',
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
