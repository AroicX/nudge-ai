import type { AuthorizationRecord, PageSnapshot, ToolCall } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateToolCall, type PolicyCtx } from './policy';
import { bindConfirmation } from './preview';

const auth = (categories: AuthorizationRecord['categories'], origins: AuthorizationRecord['origins'] = ['https://mail.test']): AuthorizationRecord => ({
  taskId: 't1',
  instruction: 'x',
  origins,
  categories,
  destinations: [],
  exclusions: [],
  limits: {},
});

const snapshot = (elements: PageSnapshot['elements']): PageSnapshot => ({
  snapshotId: 's1',
  documentId: 'doc_1',
  capturedAt: '2026-10-15T18:00:00.000Z',
  url: 'https://mail.test/inbox',
  title: 'Inbox',
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0, pageHeight: 2000 },
  elements,
  text: [],
  truncated: false,
  inaccessible: [],
});

const button = (id: string, name: string, extra: Partial<PageSnapshot['elements'][number]> = {}) => ({
  id: `doc_1:${id}`,
  kind: 'button' as const,
  name,
  visible: true,
  disabled: false,
  ...extra,
});

const ctx = (overrides: Partial<PolicyCtx> = {}): PolicyCtx => ({
  status: 'running',
  boundTabId: 1,
  knownTabIds: [1, 2],
  tabRoles: { 1: 'origin', 2: 'opened_by_nudge' },
  documentId: 'doc_1',
  snapshot: snapshot([
    button('1', 'Next page'),
    button('2', 'Place order'),
    button('3', 'Move to Trash'),
    button('4', 'Archive'),
    button('5', 'Delete forever'),
    { id: 'doc_1:6', kind: 'input', inputType: 'password', name: 'Password', visible: true, disabled: false },
    { id: 'doc_1:7', kind: 'input', inputType: 'text', name: 'Card number', visible: true, disabled: false, formHasSensitiveField: true },
  ]),
  authorization: auth(['read', 'navigate']),
  navigation: { userTypedUrls: [], observedUrls: [], taskOrigins: ['https://mail.test'], recordValues: [] },
  now: 0,
  ...overrides,
});

const click = (id: string, tabId = 1): ToolCall => ({ tool: 'click', tabId, elementId: `doc_1:${id}` });

describe('evaluateToolCall', () => {
  it('allows a routine in-scope click without prompting', () => {
    expect(evaluateToolCall(ctx(), click('1'))).toEqual({ decision: 'allow' });
  });

  it('blocks purchases even when requested', () => {
    expect(
      evaluateToolCall(ctx({ authorization: auth(['read', 'navigate', 'purchase']) }), click('2')).decision,
    ).toBe('block');
  });

  it('blocks typing into password and card fields', () => {
    const type = (id: string): ToolCall => ({ tool: 'type_text', tabId: 1, elementId: `doc_1:${id}`, text: 'x', mode: 'replace' });
    const fillCtx = ctx({ authorization: auth(['read', 'navigate', 'fill']) });
    expect(evaluateToolCall(fillCtx, type('6')).decision).toBe('block');
    expect(evaluateToolCall(fillCtx, type('7')).decision).toBe('block');
  });

  it('requires confirmation for bulk reversible moves', () => {
    const outcome = evaluateToolCall(
      ctx({ authorization: auth(['read', 'navigate', 'move_reversible']), bulkCount: 12 }),
      click('3'),
    );
    expect(outcome).toMatchObject({ decision: 'confirm', category: 'move_reversible' });
  });

  it('allows the bulk move once a matching confirmation is bound', () => {
    const preview = {
      previewId: 'p1', operation: 'Move to Trash', location: 'Inbox', criteria: 'invoice', count: 12,
      samples: [], reversible: true, permanent: false, targetFingerprint: 'fp-12',
    };
    const outcome = evaluateToolCall(
      ctx({
        authorization: auth(['read', 'navigate', 'move_reversible']),
        bulkCount: 12,
        confirmation: bindConfirmation(preview, 0),
        currentFingerprint: 'fp-12',
        generation: 0,
      }),
      click('3'),
    );
    expect(outcome).toEqual({ decision: 'allow' });
  });

  it('blocks out-of-scope consequential actions (page text cannot authorize them)', () => {
    expect(evaluateToolCall(ctx(), click('3')).decision).toBe('block');
    expect(evaluateToolCall(ctx({ authorization: auth(['read', 'navigate', 'move_reversible']) }), click('5')).decision).toBe('block');
  });

  it('lets a risk label raise but never lower the risk', () => {
    const scoped = ctx({ authorization: auth(['read', 'navigate', 'move_reversible', 'edit']) });
    expect(evaluateToolCall({ ...scoped, riskLabel: 'consequential' }, click('4')).decision).toBe('confirm');
    expect(
      evaluateToolCall(
        { ...ctx({ authorization: auth(['read', 'navigate', 'delete_permanent']) }), riskLabel: 'none' },
        click('5'),
      ).decision,
    ).toBe('confirm');
  });

  it('rejects actions on unknown or non-bound tabs', () => {
    expect(evaluateToolCall(ctx(), click('1', 9)).decision).toBe('block');
    expect(evaluateToolCall(ctx(), click('1', 2)).decision).toBe('block');
  });

  it('only closes tabs Nudge opened', () => {
    expect(evaluateToolCall(ctx(), { tool: 'close_tab', tabId: 1 }).decision).toBe('block');
    expect(evaluateToolCall(ctx(), { tool: 'close_tab', tabId: 2 }).decision).toBe('allow');
  });

  it('blocks everything when the task is not running', () => {
    expect(evaluateToolCall(ctx({ status: 'paused' }), click('1')).decision).toBe('block');
  });

  it('rejects stale element references from another document', () => {
    expect(evaluateToolCall(ctx(), { tool: 'click', tabId: 1, elementId: 'doc_0:1' }).decision).toBe('block');
  });

  it('blocks stale visual actions', () => {
    const frame = {
      screenshotId: 'shot', tabId: 1, documentId: 'doc_1', url: 'https://mail.test/inbox', capturedAt: 0,
      viewport: { cssWidth: 1000, cssHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      imageWidth: 1000, imageHeight: 800, coordinateSpace: 'css_viewport' as const, mutationCounterAtCapture: 0,
    };
    const current = { tabId: 1, documentId: 'doc_1', url: 'https://mail.test/inbox', scrollX: 0, scrollY: 300, cssWidth: 1000, cssHeight: 800, mutationCounter: 0 };
    const outcome = evaluateToolCall(
      ctx({ authorization: auth(['read', 'navigate', 'edit']), frame, frameCurrent: current }),
      { tool: 'click_at', tabId: 1, screenshotId: 'shot', x: 10, y: 10 },
    );
    expect(outcome.decision).toBe('block');
  });
});

describe('submission approval for save/schedule and multi-step forms', () => {
  it('classifies event Save as a submission and step navigation as navigation', async () => {
    const { classifyRisk } = await import('./risk');
    const click = { tool: 'click', tabId: 1, elementId: 'doc:1' } as const;
    expect(classifyRisk({ kind: 'button', name: 'Save' }, click).category).toBe('submit_form');
    expect(classifyRisk({ kind: 'button', name: 'Save and continue' }, click).category).toBe('navigate');
    expect(classifyRisk({ kind: 'button', name: 'Next' }, click).category).toBe('navigate');
    expect(classifyRisk({ kind: 'button', name: 'Send invitations' }, click).category).toBe('send_message');
  });

  it('never grants submission when the user said not to submit', async () => {
    const { sanitizeAuthorization } = await import('./authorization');
    const proposal = { origins: [], categories: ['fill', 'submit_form'] as const, destinations: [], exclusions: [], limits: {} };
    const fillOnly = sanitizeAuthorization({ ...proposal, categories: [...proposal.categories] }, "Fill in this application with my CV but don't submit it", 't');
    expect(fillOnly.categories).not.toContain('submit_form');
    const schedule = sanitizeAuthorization({ ...proposal, categories: [...proposal.categories] }, 'Schedule a meeting tomorrow at 9am called Sync', 't');
    expect(schedule.categories).toContain('submit_form');
    const noInvites = sanitizeAuthorization(
      { ...proposal, categories: ['fill', 'submit_form', 'send_message'] },
      'Schedule a sync tomorrow at 9am without sending invites',
      't',
    );
    expect(noInvites.categories).toContain('submit_form');
    expect(noInvites.categories).not.toContain('send_message');
  });
});
