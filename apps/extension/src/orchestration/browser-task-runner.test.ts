import type { AgentStepResponse, PageSnapshot, TabReference } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { runBrowserTask } from './browser-task-runner';

const tab = (tabId: number, url: string, active = false): TabReference => ({
  tabId, windowId: 1, active, url, title: url, domain: new URL(url).hostname,
  discarded: false, lastSeenAt: '2026-10-15T20:00:00.000Z',
});
const page = (tabId: number): PageSnapshot => ({
  snapshotId: `snap-${tabId}`, documentId: `doc-${tabId}`, capturedAt: '2026-10-15T20:00:00.000Z',
  url: tabId === 2 ? 'https://mail.google.com/' : 'https://verify.test/', title: 'Page',
  viewport: { width: 1000, height: 700, scrollX: 0, scrollY: 0, pageHeight: 900 },
  elements: [], text: [], truncated: false, inaccessible: [],
});
const task = (status: 'active' | 'completed' = 'active') => ({
  id: 'task-1', goal: 'Check Gmail', intent: 'inspect' as const, constraints: [], successConditions: ['Found'],
  missingRequiredInformation: [], risk: 'low' as const, status, cancellationGeneration: 0,
  verifiedActions: [], boundTabId: 1, boundDocumentId: 'doc-1',
});

describe('runBrowserTask', () => {
  it('reuses an existing Gmail tab, re-observes it, and can return to the origin', async () => {
    const tabs = {
      list: vi.fn().mockResolvedValue([tab(1, 'https://verify.test/', true), tab(2, 'https://mail.google.com/')]),
      activate: vi.fn(async (id: number) => tab(id, id === 2 ? 'https://mail.google.com/' : 'https://verify.test/', true)),
      open: vi.fn(),
    };
    const decisions: AgentStepResponse[] = [
      { requestId: '1', task: task(), decision: { type: 'switch_tab', taskId: 'task-1', tabId: 2, reason: 'Check Gmail' } },
      { requestId: '2', task: task(), decision: { type: 'switch_tab', taskId: 'task-1', tabId: 1, reason: 'Return' } },
      { requestId: '3', task: task('completed'), decision: { type: 'finish', taskId: 'task-1', message: 'Done', evidence: [{ kind: 'page_text', text: 'Found' }] } },
    ];
    const observeTab = vi.fn(async (id: number) => page(id));
    const handle = await runBrowserTask(
      { tabId: 1, utterance: 'Check Gmail then return', conversation: [], task: null },
      { tabs, observeTab, executeOnTab: vi.fn(), step: vi.fn(async () => decisions.shift()!) },
    );
    await expect(handle.done).resolves.toMatchObject({ status: 'completed' });
    expect(tabs.activate.mock.calls.map(([id]) => id)).toEqual([2, 1]);
    expect(observeTab.mock.calls.map(([id]) => id)).toEqual([1, 2, 1]);
  });

  it('opens Gmail explicitly when no safe Gmail tab exists', async () => {
    const tabs = {
      list: vi.fn().mockResolvedValue([tab(1, 'https://verify.test/', true)]),
      activate: vi.fn(),
      open: vi.fn().mockResolvedValue(tab(3, 'https://mail.google.com/', true)),
    };
    const handle = await runBrowserTask(
      { tabId: 1, utterance: 'Go to Gmail', conversation: [], task: null },
      {
        tabs,
        observeTab: async () => page(1),
        executeOnTab: vi.fn(),
        step: async () => ({ requestId: '1', task: task('completed'), decision: { type: 'finish', taskId: 'task-1', message: 'Done', evidence: [{ kind: 'page_text', text: 'Found' }] } }),
      },
    );
    await handle.done;
    expect(tabs.open).toHaveBeenCalledWith('https://mail.google.com/');
  });

  it('rejects switches to tab IDs outside the supplied inventory', async () => {
    const handle = await runBrowserTask(
      { tabId: 1, utterance: 'Switch', conversation: [], task: null },
      {
        tabs: { list: async () => [tab(1, 'https://verify.test/', true)], activate: vi.fn(), open: vi.fn() },
        observeTab: async () => page(1), executeOnTab: vi.fn(),
        step: async () => ({ requestId: '1', task: task(), decision: { type: 'switch_tab', taskId: 'task-1', tabId: 99, reason: 'Invented' } }),
      },
    );
    await expect(handle.done).resolves.toMatchObject({ status: 'failed', reason: expect.stringMatching(/not available/i) });
  });

  it('attaches only freshly observed sources and deduplicates normalized sensitive URLs', async () => {
    const onMessage = vi.fn();
    const tabs = {
      list: vi.fn().mockResolvedValue([tab(1, 'https://verify.test/?otp=123456&view=login', true)]),
      activate: vi.fn(), open: vi.fn(),
    };
    const handle = await runBrowserTask(
      { tabId: 1, utterance: 'Inspect', conversation: [], task: null },
      {
        tabs,
        observeTab: async () => ({ ...page(1), url: 'https://verify.test/?otp=123456&view=login' }),
        executeOnTab: vi.fn(), onMessage,
        step: async () => ({ requestId: '1', task: task('completed'), decision: { type: 'finish', taskId: 'task-1', message: 'Done', evidence: [{ kind: 'page_text', text: 'Found' }] } }),
      },
    );
    await handle.done;
    expect(onMessage).toHaveBeenCalledWith('Done', [
      expect.objectContaining({ url: 'https://verify.test/?view=login' }),
    ]);
  });
});
