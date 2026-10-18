import { describe, expect, it } from 'vitest';

import {
  AgentDecisionSchema,
  BrowserContextSchema,
  BrowserActionSchema,
  ExtensionMessageSchema,
  PageSnapshotSchema,
  PersistedConversationSchema,
  ProviderCapabilitiesSchema,
  ProviderSelectionSchema,
  SourceReferenceSchema,
  SensitiveTransferActionSchema,
  SwitchTabDecisionSchema,
  TaskStateSchema,
  TimelineStepSchema,
  VoiceEventSchema,
  VoiceToolResultSchema,
} from './index';

describe('realtime voice contracts', () => {
  it('accepts a strict run_browser_task intent', () => {
    expect(
      VoiceEventSchema.parse({
        type: 'function.intent',
        name: 'run_browser_task',
        callId: 'call_123',
        arguments: { goal: 'Find the cheapest black kettle' },
      }),
    ).toEqual({
      type: 'function.intent',
      name: 'run_browser_task',
      callId: 'call_123',
      arguments: { goal: 'Find the cheapest black kettle' },
    });
    expect(
      VoiceEventSchema.safeParse({
        type: 'function.intent',
        name: 'run_browser_task',
        callId: '',
        arguments: { goal: 'Find a kettle' },
      }).success,
    ).toBe(false);
  });

  it('rejects malformed tool results', () => {
    const source = {
      tabId: 7,
      windowId: 1,
      active: true,
      url: 'https://shop.example.test/kettles',
      title: 'Kettles',
      domain: 'shop.example.test',
      discarded: false,
      lastSeenAt: '2026-10-15T18:00:00.000Z',
    };
    expect(
      VoiceToolResultSchema.parse({ ok: true, message: 'Found three kettles.', sources: [source] }),
    ).toEqual({ ok: true, message: 'Found three kettles.', sources: [source] });
    expect(
      VoiceToolResultSchema.safeParse({ ok: true, message: 'Done', internalReasoning: 'secret' })
        .success,
    ).toBe(false);
    expect(VoiceToolResultSchema.safeParse({ ok: 'yes', message: 'Done' }).success).toBe(false);
  });
});

describe('SensitiveTransferActionSchema', () => {
  it('stays outside provider-visible browser actions', () => {
    const transfer = {
      type: 'sensitive_transfer', taskId: 'task-1', destinationTabId: 1,
      destinationDocumentId: 'doc-1', elementId: 'doc-1:1', cancellationGeneration: 0,
      expectedLength: 6,
    };
    expect(SensitiveTransferActionSchema.safeParse(transfer).success).toBe(true);
    expect(BrowserActionSchema.safeParse(transfer).success).toBe(false);
  });
});

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

describe('browser-wide contracts', () => {
  const tab = {
    tabId: 7,
    windowId: 1,
    active: false,
    url: 'https://mail.example.test/inbox',
    title: 'Inbox',
    domain: 'mail.example.test',
    favIconUrl: 'https://mail.example.test/favicon.ico',
    discarded: false,
    lastSeenAt: '2026-10-15T18:00:00.000Z',
  };

  it('accepts only bounded HTTP sources', () => {
    expect(SourceReferenceSchema.safeParse(tab).success).toBe(true);
    expect(SourceReferenceSchema.safeParse({ ...tab, url: 'chrome://settings' }).success).toBe(false);
    expect(SourceReferenceSchema.safeParse({ ...tab, title: 'x'.repeat(501) }).success).toBe(false);
    expect(SourceReferenceSchema.safeParse({ ...tab, domain: 'x'.repeat(254) }).success).toBe(false);
    expect(SourceReferenceSchema.safeParse({ ...tab, favIconUrl: 'x'.repeat(2_001) }).success).toBe(false);
  });

  it('keeps persisted turns strict and free of sensitive payload fields', () => {
    const conversation = {
      version: 1,
      turns: [{
        id: 'turn_1',
        role: 'assistant',
        text: 'Found the message.',
        createdAt: '2026-10-15T18:00:00.000Z',
        provider: 'ollama',
        model: 'qwen3',
        sources: [tab],
      }],
      timeline: [],
    };
    expect(PersistedConversationSchema.safeParse(conversation).success).toBe(true);
    for (const forbidden of ['otp', 'password', 'apiKey', 'snapshot']) {
      expect(
        PersistedConversationSchema.safeParse({ ...conversation, [forbidden]: 'secret' }).success,
      ).toBe(false);
    }
    expect(
      PersistedConversationSchema.safeParse({
        ...conversation,
        turns: [{ ...conversation.turns[0], otp: '123456' }],
      }).success,
    ).toBe(false);
  });

  it('bounds sources, tabs, and timeline statuses', () => {
    expect(TimelineStepSchema.safeParse({ id: 'step_1', label: 'Opening Gmail', status: 'active' }).success).toBe(true);
    expect(TimelineStepSchema.safeParse({ id: 'step_1', label: 'Opening Gmail', status: 'thinking' }).success).toBe(false);
    expect(BrowserContextSchema.safeParse({ tabs: [tab], originTab: tab, currentTabId: 7 }).success).toBe(true);
    expect(BrowserContextSchema.safeParse({ tabs: Array.from({ length: 101 }, () => tab), currentTabId: 7 }).success).toBe(false);
  });

  it('validates provider choices and capabilities', () => {
    expect(ProviderSelectionSchema.safeParse({ provider: 'openai' }).success).toBe(true);
    expect(ProviderSelectionSchema.safeParse({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3' }).success).toBe(true);
    expect(ProviderSelectionSchema.safeParse({ provider: 'chatgpt', accountId: 'account-1', model: 'gpt-test' }).success).toBe(true);
    expect(ProviderSelectionSchema.safeParse({ provider: 'anthropic' }).success).toBe(false);
    expect(ProviderCapabilitiesSchema.safeParse({ browserTools: true, realtimeVoice: false, dictation: true }).success).toBe(true);
  });

  it('switches only to an inventoried tab identifier', () => {
    expect(SwitchTabDecisionSchema.safeParse({ type: 'switch_tab', taskId: 'task_1', tabId: 7, reason: 'Open Gmail' }).success).toBe(true);
    expect(SwitchTabDecisionSchema.safeParse({ type: 'switch_tab', taskId: 'task_1', url: 'https://mail.example.test' }).success).toBe(false);
  });
});
