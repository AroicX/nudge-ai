import type { BrowserContext, TabReference } from '@nudge/contracts';

import { runTask, type RunTaskDependencies, type RunTaskInput, type TaskRunHandle } from './run-task';

interface BrowserTabs {
  list(): Promise<TabReference[]>;
  activate(tabId: number): Promise<TabReference>;
  open(url: string): Promise<TabReference>;
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
  return runTask(
    { ...input, browserContext },
    {
      ...dependencies,
      observe: (signal, tabId = input.tabId) => dependencies.observeTab(tabId, signal),
      execute: (action, guard, signal) =>
        dependencies.executeOnTab(guard.tabId, action, guard, signal),
      switchTab: async (tabId) => {
        await dependencies.tabs.activate(tabId);
      },
    },
  );
}
