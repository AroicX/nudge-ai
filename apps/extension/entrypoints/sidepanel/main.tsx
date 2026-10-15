import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SidePanel } from '../../src/components/SidePanel';
import { ServerClient } from '../../src/api/server-client';
import { runTask, type TaskRunHandle } from '../../src/orchestration/run-task';
import { useNudgeStore } from '../../src/state/use-nudge-store';
import '../../src/styles/app.css';

const client = new ServerClient();
let activeRun: TaskRunHandle | undefined;
let activeRunId = 0;

async function sendToPage<T>(tabId: number, message: unknown): Promise<T> {
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  }
}

function App() {
  const state = useNudgeStore();
  const send = async (utterance: string) => {
    activeRun?.stop();
    const runId = ++activeRunId;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      state.setStatus('This page is not available to Nudge.');
      return;
    }
    const userTurn = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      text: utterance,
      createdAt: new Date().toISOString(),
    };
    state.addTurn(userTurn);
    state.setBusy(true);
    activeRun = runTask(
      {
        tabId: tab.id,
        utterance,
        conversation: [...state.conversation, userTurn],
        task: state.task,
      },
      {
        observe: async () =>
          sendToPage(tab.id!, {
            type: 'page.observe',
            requestId: crypto.randomUUID(),
            taskId: state.task?.id ?? 'new',
          }),
        step: (request, signal) => client.step(request, signal),
        execute: async (action, guard) =>
          sendToPage(tab.id!, {
            type: 'page.execute',
            requestId: crypto.randomUUID(),
            taskId: state.task?.id ?? 'new',
            tabId: guard.tabId,
            documentId: guard.documentId,
            cancellationGeneration: guard.cancellationGeneration,
            action,
          }),
        onStatus: state.setStatus,
        onAction: state.addAction,
        onMessage: (text) =>
          state.addTurn({
            id: crypto.randomUUID(),
            role: 'assistant',
            text,
            createdAt: new Date().toISOString(),
          }),
      },
    );
    const result = await activeRun.done;
    if (runId !== activeRunId) return;
    if ('id' in result) state.setTask(result);
    else if (result.reason) state.setStatus(result.reason);
    state.setBusy(false);
  };
  return (
    <SidePanel
      busy={state.busy}
      status={state.status}
      conversation={state.conversation}
      actions={state.actions}
      onSend={(text) => void send(text)}
      onStop={() => activeRun?.stop()}
      onSaveKey={(key) =>
        void client
          .setProviderKey(key)
          .then(() => state.setStatus('Using your key for this backend session.'))
          .catch((error: unknown) =>
            state.setStatus(error instanceof Error ? error.message : 'Could not save key.'),
          )
      }
      onClearKey={() =>
        void client
          .clearProviderKey()
          .then(() => state.setStatus('Using the local default key.'))
          .catch((error: unknown) =>
            state.setStatus(error instanceof Error ? error.message : 'Could not clear key.'),
          )
      }
      onClearHistory={state.clearHistory}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
