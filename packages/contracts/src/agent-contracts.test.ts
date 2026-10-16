import { describe, expect, it } from 'vitest';

import {
  KeyChordSchema,
  OperationPreviewSchema,
  PlannerResponseSchema,
  ToolCallSchema,
  ControllerSnapshotSchema,
  PanelMessageSchema,
  ContentRequestSchema,
  ScreenshotFrameSchema,
  PageSnapshotSchema,
  MUTATING_TOOLS,
} from './index';

const el = 'doc_1:4';
const examples: Record<string, unknown> = {
  list_tabs: { tool: 'list_tabs' },
  observe_tab: { tool: 'observe_tab', tabId: 1, screenshot: true },
  read_text: { tool: 'read_text', tabId: 1, elementId: el },
  inspect_element: { tool: 'inspect_element', tabId: 1, elementId: el },
  open_tab: { tool: 'open_tab', url: 'https://example.com/jobs' },
  activate_tab: { tool: 'activate_tab', tabId: 2 },
  navigate: { tool: 'navigate', tabId: 1, url: 'https://example.com/' },
  go_back: { tool: 'go_back', tabId: 1 },
  go_forward: { tool: 'go_forward', tabId: 1 },
  reload: { tool: 'reload', tabId: 1 },
  close_tab: { tool: 'close_tab', tabId: 3 },
  click: { tool: 'click', tabId: 1, elementId: el },
  double_click: { tool: 'double_click', tabId: 1, elementId: el },
  hover: { tool: 'hover', tabId: 1, elementId: el },
  focus: { tool: 'focus', tabId: 1, elementId: el },
  type_text: { tool: 'type_text', tabId: 1, elementId: el, text: 'hi', mode: 'replace' },
  press_keys: { tool: 'press_keys', tabId: 1, keys: ['Control+A', 'Enter'] },
  select_option: { tool: 'select_option', tabId: 1, elementId: el, value: 'Black' },
  scroll: { tool: 'scroll', tabId: 1, direction: 'down', amount: 'viewport' },
  drag: { tool: 'drag', tabId: 1, fromElementId: el, toElementId: 'doc_1:5' },
  wait_for: { tool: 'wait_for', tabId: 1, condition: { kind: 'text_present', text: 'Done' }, timeoutMs: 2000 },
  click_at: { tool: 'click_at', tabId: 1, screenshotId: 'shot_1', x: 10, y: 20 },
  double_click_at: { tool: 'double_click_at', tabId: 1, screenshotId: 'shot_1', x: 10, y: 20 },
  drag_at: { tool: 'drag_at', tabId: 1, screenshotId: 'shot_1', from: { x: 1, y: 2 }, to: { x: 30, y: 2 } },
  type_at: { tool: 'type_at', tabId: 1, screenshotId: 'shot_1', x: 1, y: 2, text: 'Grand Opening' },
  ask_user: { tool: 'ask_user', question: 'Which sheet?', missing: ['destination'] },
  request_confirmation: {
    tool: 'request_confirmation',
    preview: { operation: 'Move to Trash', location: 'Inbox', criteria: 'invoice', count: 5, samples: ['a'], reversible: true, permanent: false },
  },
  record_items: { tool: 'record_items', records: [{ fields: { title: 'Dev' }, sourceUrl: 'https://x.test/1' }] },
  export_records: { tool: 'export_records', format: 'csv' },
  start_timed_repeat: {
    tool: 'start_timed_repeat', tabId: 1, action: { kind: 'scroll', direction: 'down', amount: 'viewport' },
    intervalMs: 3000, maxDurationMs: 600000,
  },
  transfer_code: { tool: 'transfer_code', sourceTabId: 2, service: 'Acme', destinationTabId: 1, destinationElementId: el },
  finish: { tool: 'finish', summary: 'Done', evidence: ['Read back 5 rows'] },
  report_partial: { tool: 'report_partial', done: ['a'], remaining: ['b'], reason: 'Blocked by a human check' },
};

describe('ToolCallSchema', () => {
  it('accepts every tool name in the spec vocabulary (33 tools)', () => {
    expect(Object.keys(examples)).toHaveLength(33);
    for (const [name, value] of Object.entries(examples)) {
      const parsed = ToolCallSchema.safeParse(value);
      expect(parsed.success, `${name}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('rejects blocked key chords', () => {
    for (const chord of ['Control+W', 'Meta+T', 'F12', 'Control+Shift+I', 'Meta+Q', 'Control+N']) {
      expect(KeyChordSchema.safeParse(chord).success, chord).toBe(false);
    }
    for (const chord of ['Control+A', 'Enter', 'Shift+Tab', 'a', 'Meta+B', 'PageDown']) {
      expect(KeyChordSchema.safeParse(chord).success, chord).toBe(true);
    }
  });

  it('rejects non-http navigation', () => {
    expect(ToolCallSchema.safeParse({ tool: 'navigate', tabId: 1, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(ToolCallSchema.safeParse({ tool: 'open_tab', url: 'file:///etc/passwd' }).success).toBe(false);
  });

  it('rejects unknown tool and extra fields', () => {
    expect(ToolCallSchema.safeParse({ tool: 'eval', code: 'x' }).success).toBe(false);
    expect(ToolCallSchema.safeParse({ tool: 'click', tabId: 1, elementId: el, script: 'x' }).success).toBe(false);
  });

  it('enforces timed repeat bounds', () => {
    const base = examples.start_timed_repeat as Record<string, unknown>;
    expect(ToolCallSchema.safeParse({ ...base, intervalMs: 999 }).success).toBe(false);
    expect(ToolCallSchema.safeParse({ ...base, maxDurationMs: 1_800_001 }).success).toBe(false);
  });

  it('marks mutating tools', () => {
    expect(MUTATING_TOOLS.has('click')).toBe(true);
    expect(MUTATING_TOOLS.has('transfer_code')).toBe(true);
    expect(MUTATING_TOOLS.has('observe_tab')).toBe(false);
    expect(MUTATING_TOOLS.has('list_tabs')).toBe(false);
  });
});

describe('planner and preview contracts', () => {
  it('planner response requires exactly one toolCall', () => {
    expect(PlannerResponseSchema.safeParse({ requestId: 'r' }).success).toBe(false);
    expect(
      PlannerResponseSchema.safeParse({ requestId: 'r', toolCall: examples.click }).success,
    ).toBe(true);
    expect(
      PlannerResponseSchema.safeParse({ requestId: 'r', toolCall: [examples.click, examples.click] }).success,
    ).toBe(false);
  });

  it('caps preview samples at 5', () => {
    const preview = {
      previewId: 'p1', operation: 'Move', location: 'Inbox', criteria: 'x', count: 6,
      samples: ['1', '2', '3', '4', '5', '6'], reversible: true, permanent: false, targetFingerprint: 'f',
    };
    expect(OperationPreviewSchema.safeParse(preview).success).toBe(false);
    expect(OperationPreviewSchema.safeParse({ ...preview, samples: preview.samples.slice(0, 5) }).success).toBe(true);
  });
});

describe('controller and content messages', () => {
  it('parses panel instruct and idle controller snapshot', () => {
    expect(PanelMessageSchema.safeParse({ type: 'instruct', text: 'stop', source: 'voice' }).success).toBe(true);
    expect(
      ControllerSnapshotSchema.safeParse({
        status: 'idle', plan: [], memorySummary: { recordCount: 0, issues: [] },
        capability: 'dom_only', timeline: [],
      }).success,
    ).toBe(true);
  });

  it('content execute only accepts DOM tools', () => {
    expect(
      ContentRequestSchema.safeParse({ type: 'execute', call: examples.click, documentId: 'doc_1', generation: 0 }).success,
    ).toBe(true);
    expect(
      ContentRequestSchema.safeParse({ type: 'execute', call: examples.open_tab, documentId: 'doc_1', generation: 0 }).success,
    ).toBe(false);
  });

  it('screenshot frame records url and coordinate space', () => {
    const frame = {
      screenshotId: 's', tabId: 1, documentId: 'd', url: 'https://x.test/', capturedAt: 1,
      viewport: { cssWidth: 100, cssHeight: 100, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
      imageWidth: 200, imageHeight: 200, coordinateSpace: 'css_viewport', mutationCounterAtCapture: 0,
    };
    expect(ScreenshotFrameSchema.safeParse(frame).success).toBe(true);
  });

  it('page snapshot accepts an absent mutationCounter (treated as 0)', () => {
    const snap = PageSnapshotSchema.parse({
      snapshotId: 's', documentId: 'doc_1', capturedAt: '2026-10-15T18:00:00.000Z', url: 'https://x.test/', title: 't',
      viewport: { width: 1, height: 1, scrollX: 0, scrollY: 0, pageHeight: 1 },
      elements: [], text: [], truncated: false, inaccessible: [],
    });
    expect(snap.mutationCounter ?? 0).toBe(0);
  });
});
