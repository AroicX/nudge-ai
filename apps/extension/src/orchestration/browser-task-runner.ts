import type { BrowserContext, PageSnapshot, SourceReference, TabReference } from '@nudge/contracts';

import { runTask, type RunTaskDependencies, type RunTaskInput, type TaskRunHandle } from './run-task';

interface BrowserTabs {
  list(): Promise<TabReference[]>;
  activate(tabId: number): Promise<TabReference>;
  open(url: string): Promise<TabReference>;
}

const SENSITIVE_QUERY_KEYS = /^(otp|code|token|password|secret|key|auth|session)$/i;

export function sanitizeSourceReference(
  tab: TabReference,
  page?: PageSnapshot,
): SourceReference | undefined {
  try {
    const url = new URL(page?.url ?? tab.url);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    }
    return {
      ...tab,
      url: url.href,
      title: page?.title ?? tab.title,
      domain: url.hostname,
      lastSeenAt: page?.capturedAt ?? tab.lastSeenAt,
    };
  } catch {
    return undefined;
  }
}

type BrowserTaskDependencies = Omit<RunTaskDependencies, 'observe' | 'execute' | 'switchTab'> & {
  tabs: BrowserTabs;
  observeTab(tabId: number, signal: AbortSignal): ReturnType<RunTaskDependencies['observe']>;
  executeOnTab(
    tabId: number,
    ...args: Parameters<RunTaskDependencies['execute']>
  ): ReturnType<RunTaskDependencies['execute']>;
};

export async function runBrowserTask(
  input: RunTaskInput,
  dependencies: BrowserTaskDependencies,
): Promise<TaskRunHandle> {
  let tabs = await dependencies.tabs.list();
  if (/\bgmail\b/i.test(input.utterance) && !tabs.some((tab) => tab.domain === 'mail.google.com')) {
    const opened = await dependencies.tabs.open('https://mail.google.com/');
    tabs = [...tabs, opened];
  }
  const origin = tabs.find((tab) => tab.tabId === input.tabId);
  if (!origin) {
    return runTask(input, {
      ...dependencies,
      observe: async () => {
        throw new Error('The origin browser tab is not available.');
      },
      execute: async () => {
        throw new Error('The origin browser tab is not available.');
      },
    });
  }
  const browserContext: BrowserContext = { tabs, originTab: origin, currentTabId: origin.tabId };
  const visited = new Map<string, SourceReference>();
  let lastSource: SourceReference | undefined;
  return runTask(
    { ...input, browserContext },
    {
      ...dependencies,
      observe: async (signal, tabId = input.tabId) => {
        const page = await dependencies.observeTab(tabId, signal);
        const tab = tabs.find((candidate) => candidate.tabId === tabId);
        const source = tab && sanitizeSourceReference(tab, page);
        if (source) {
          visited.set(source.url, source);
          lastSource = source;
        }
        return page;
      },
      execute: (action, guard, signal) =>
        dependencies.executeOnTab(guard.tabId, action, guard, signal),
      switchTab: async (tabId) => {
        await dependencies.tabs.activate(tabId);
      },
      onMessage: (message) => dependencies.onMessage?.(message, [...visited.values()]),
      onTimelineStep: (step) =>
        dependencies.onTimelineStep?.({
          ...step,
          ...(step.status === 'completed' && !step.sources?.length && lastSource
            ? { sources: [lastSource] }
            : {}),
        }),
    },
  );
}
