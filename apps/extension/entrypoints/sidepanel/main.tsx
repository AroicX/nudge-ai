import { StrictMode, useEffect, useRef, useState } from 'react';
import {
  ProviderSelectionSchema,
  type ProviderSelection,
  type SourceReference,
  type VoiceToolResult,
} from '@nudge/contracts';
import { createRoot } from 'react-dom/client';

import { SidePanel } from '../../src/components/SidePanel';
import { ServerClient } from '../../src/api/server-client';
import type { TaskRunHandle } from '../../src/orchestration/run-task';
import {
  runBrowserTask,
  sanitizeSourceReference,
} from '../../src/orchestration/browser-task-runner';
import { ProviderFallbackController, type ProviderFallbackRequest } from '../../src/orchestration/provider-fallback';
import { useNudgeStore } from '../../src/state/use-nudge-store';
import { PushToTalkTransport } from '../../src/voice/push-to-talk-transport';
import {
  browserRealtimeDependencies,
  createRealtimeVoiceTransport,
} from '../../src/voice/realtime-transport';
import { VoiceSessionController } from '../../src/voice/voice-session-controller';
import { createVoiceTaskBridge } from '../../src/voice/voice-task-bridge';
import {
  createVoiceConversation,
  routeComposerText,
} from '../../src/voice/voice-conversation';
import { openMicrophoneSetup, probeMicrophone } from '../../src/permissions/microphone';
import { TabRegistry } from '../../src/tabs/tab-registry';
import { reconcileProviderSelection } from '../../src/providers/provider-selection';
import '../../src/styles/app.css';

const client = new ServerClient(
  import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
  import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
);
let activeRun: TaskRunHandle | undefined;
let activeRunId = 0;
const tabRegistry = new TabRegistry();

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
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const voiceTaskRef = useRef<(goal: string) => Promise<VoiceToolResult>>(async () => ({
    ok: false,
    message: 'Voice browser control is not ready.',
  }));
  const controllerRef = useRef<VoiceSessionController | undefined>(undefined);
  const voiceConversationRef = useRef<ReturnType<typeof createVoiceConversation> | undefined>(
    undefined,
  );
  const pushToTalkRef = useRef(
    new PushToTalkTransport((audio, signal) => client.transcribe(audio, signal)),
  );
  const [pushRecording, setPushRecording] = useState(false);
  const [providerSelection, setProviderSelection] = useState<ProviderSelection>({ provider: 'openai' });
  const [providerHealth, setProviderHealth] = useState<Awaited<ReturnType<typeof client.getProviderHealth>>>();
  const [fallbackRequest, setFallbackRequest] = useState<ProviderFallbackRequest>();
  const fallbackRef = useRef<ProviderFallbackController | undefined>(undefined);
  const refreshProviders = async (baseUrl = providerSelection.provider === 'ollama' ? providerSelection.baseUrl : undefined) => {
    setProviderHealth(await client.getProviderHealth(baseUrl));
  };
  const selectProvider = async (selection: ProviderSelection) => {
    await client.setProviderSelection(selection);
    await browser.storage.local.set({ providerSelection: selection });
    setProviderSelection(selection);
    state.setStatus(selection.provider === 'ollama' ? `Using local Ollama: ${selection.model}` : 'Using OpenAI.');
  };
  const send = async (utterance: string) => {
    if (useNudgeStore.getState().busy) return;
    state.setBusy(true);
    const runId = ++activeRunId;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      state.setStatus('This page is not available to Nudge.');
      state.setBusy(false);
      return;
    }
    const knownTabs = await tabRegistry.list();
    const originSource = knownTabs.find((candidate) => candidate.tabId === tab.id);
    const safeOriginSource = originSource && sanitizeSourceReference(originSource);
    const userTurn = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      text: utterance,
      createdAt: new Date().toISOString(),
      sources: safeOriginSource ? [safeOriginSource] : [],
    };
    state.addTurn(userTurn);
    const fallback = new ProviderFallbackController();
    fallbackRef.current = fallback;
    setFallbackRequest(undefined);
    activeRun = await runBrowserTask(
      {
        tabId: tab.id,
        utterance,
        conversation: [...state.conversation, userTurn],
        task: state.task,
        provider: providerSelection.provider,
      },
      {
        tabs: tabRegistry,
        observeTab: async (targetTabId) =>
          sendToPage(targetTabId, {
            type: 'page.observe',
            requestId: crypto.randomUUID(),
            taskId: state.task?.id ?? 'new',
          }),
        step: (request, signal, provider) => client.step(request, signal, provider),
        executeOnTab: async (targetTabId, action, guard) =>
          sendToPage(targetTabId, {
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
        onMessage: (text, sources) =>
          state.addTurn({
            id: crypto.randomUUID(),
            role: 'assistant',
            text,
            createdAt: new Date().toISOString(),
            sources: sources ?? [],
          }),
        onTimelineStep: state.setTimelineStep,
        fallback,
        onFallbackRequest: setFallbackRequest,
      },
    );
    const result = await activeRun.done;
    if (runId !== activeRunId) return;
    if ('id' in result) state.setTask(result);
    else if (result.reason) state.setStatus(result.reason);
    state.setBusy(false);
    setFallbackRequest(undefined);
  };
  sendRef.current = (text) => void send(text);

  if (!voiceConversationRef.current) {
    voiceConversationRef.current = createVoiceConversation({
      addTurn: (turn) => useNudgeStore.getState().addTurn(turn),
      setLiveTranscript: (text) => useNudgeStore.getState().setVoiceTranscript(text),
    });
  }

  if (!controllerRef.current) {
    const bridge = createVoiceTaskBridge({
      runBrowserTask: (goal) => voiceTaskRef.current(goal),
      returnResult: (callId, result) => controllerRef.current?.sendToolResult(callId, result),
      stopTask: () => activeRun?.stop(),
    });
    controllerRef.current = new VoiceSessionController(
      createRealtimeVoiceTransport(browserRealtimeDependencies()),
      (signal) => client.issueRealtimeSession(signal),
      (event) => {
        void bridge(event);
        voiceConversationRef.current?.handle(event);
        const current = useNudgeStore.getState();
        if (event.type === 'state') current.setVoiceState(event.state);
        if (event.type === 'error') current.setStatus(event.message);
      },
    );
  }

  voiceTaskRef.current = async (goal) => {
    const current = useNudgeStore.getState();
    if (current.busy) return { ok: false, message: 'Nudge is already working on a task.' };
    current.setBusy(true);
    const runId = ++activeRunId;
    let finalMessage = '';
    let finalSources: SourceReference[] | undefined;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('No active browser tab is available.');
      activeRun = await runBrowserTask(
        {
          tabId: tab.id,
          utterance: goal,
          conversation: current.conversation,
          task: current.task,
          provider: 'openai',
        },
        {
          tabs: tabRegistry,
          observeTab: async (targetTabId) =>
            sendToPage(targetTabId, {
              type: 'page.observe', requestId: crypto.randomUUID(),
              taskId: current.task?.id ?? 'new',
            }),
          step: (request, signal, provider) => client.step(request, signal, provider),
          executeOnTab: async (targetTabId, action, guard) =>
            sendToPage(targetTabId, {
              type: 'page.execute', requestId: crypto.randomUUID(),
              taskId: current.task?.id ?? 'new', tabId: guard.tabId,
              documentId: guard.documentId,
              cancellationGeneration: guard.cancellationGeneration,
              action,
            }),
          onStatus: current.setStatus,
          onAction: current.addAction,
          onMessage: (message, sources) => {
            finalMessage = message;
            finalSources = sources;
          },
          onTimelineStep: current.setTimelineStep,
        },
      );
      const result = await activeRun.done;
      if (runId !== activeRunId) return { ok: false, message: 'The browser task was superseded.' };
      if ('id' in result) {
        current.setTask(result);
        return {
          ok: true,
          message: finalMessage || 'The browser task completed.',
          ...(finalSources ? { sources: finalSources } : {}),
        } as VoiceToolResult;
      }
      return {
        ok: false,
        message: result.reason || (result.status === 'stopped' ? 'The browser task was stopped.' : 'The browser task failed.'),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The browser task could not be completed.',
      };
    } finally {
      if (runId === activeRunId) current.setBusy(false);
    }
  };

  useEffect(
    () => {
      void state.hydrateHistory();
      void browser.storage.local.get('providerSelection').then(async ({ providerSelection: saved }) => {
        const parsed = ProviderSelectionSchema.safeParse(saved);
        const selection = parsed.success ? parsed.data : { provider: 'openai' as const };
        const health = await client.getProviderHealth(
          selection.provider === 'ollama' ? selection.baseUrl : undefined,
        );
        const availableSelection = reconcileProviderSelection(selection, health);
        setProviderHealth(health);
        setProviderSelection(availableSelection);
        await client.setProviderSelection(availableSelection);
        if (JSON.stringify(availableSelection) !== JSON.stringify(selection)) {
          await browser.storage.local.set({ providerSelection: availableSelection });
          state.setStatus(
            availableSelection.provider === 'openai'
              ? 'Ollama has no available model. Using OpenAI.'
              : `Using local Ollama: ${availableSelection.model}`,
          );
        }
      });
      return () => {
        void controllerRef.current?.end();
        void pushToTalkRef.current.cancel();
        activeRun?.stop();
      };
    },
    [],
  );

  const ensureMicrophone = async () => {
    const setup = await browser.storage.local.get('microphoneSetupCompleted');
    if (!setup.microphoneSetupCompleted) {
      await openMicrophoneSetup();
      state.setStatus('Finish microphone setup in the new tab, then try again.');
      return false;
    }
    const permission = await probeMicrophone();
    if (permission !== 'granted') {
      await openMicrophoneSetup();
      state.setStatus('Microphone access needs attention in the setup tab.');
      return false;
    }
    return true;
  };

  const togglePushToTalk = async (): Promise<string | undefined> => {
    try {
      if (!pushRecording) {
        if (!(await ensureMicrophone())) return '';
        await pushToTalkRef.current.start();
        setPushRecording(true);
        state.setStatus('Listening — tap again when finished.');
        return undefined;
      } else {
        setPushRecording(false);
        const text = await pushToTalkRef.current.stop();
        state.setStatus(text ? 'Dictation ready to review.' : 'No speech detected.');
        return text;
      }
    } catch (error) {
      setPushRecording(false);
      state.setStatus(error instanceof Error ? error.message : 'Voice recording failed.');
      return '';
    }
  };
  return (
    <SidePanel
      busy={state.busy}
      status={state.status}
      conversation={state.conversation}
      timeline={state.timeline}
      providerSelection={providerSelection}
      providerHealth={providerHealth}
      onProviderSelection={(selection) => void selectProvider(selection)}
      onRefreshProviders={() => void refreshProviders()}
      fallbackRequest={fallbackRequest}
      onApproveFallback={() => {
        if (fallbackRequest) fallbackRef.current?.approveFallback(fallbackRequest.id, fallbackRequest.taskId);
        setFallbackRequest(undefined);
      }}
      onDeclineFallback={() => {
        if (fallbackRequest) fallbackRef.current?.declineFallback(fallbackRequest.id, fallbackRequest.taskId);
        setFallbackRequest(undefined);
      }}
      actions={state.actions}
      onSend={(text) =>
        routeComposerText(text, {
          voiceActive: providerSelection.provider === 'openai' && Boolean(controllerRef.current?.active),
          sendRealtimeText: (value) => {
            state.addTurn({
              id: crypto.randomUUID(), role: 'user', text: value,
              createdAt: new Date().toISOString(),
            });
            controllerRef.current?.sendText(value);
          },
          sendTextTask: (value) => void send(value),
        })
      }
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
      onOpenSource={(source) =>
        void tabRegistry.resolveSource(source).then(async (resolved) => {
          if (resolved.kind === 'existing' && resolved.tab) {
            await tabRegistry.activate(resolved.tab.tabId);
          } else {
            await tabRegistry.open(resolved.url);
          }
        })
      }
      voiceState={state.voiceState}
      voiceTranscript={state.voiceTranscript}
      showRealtimeVoice={providerSelection.provider === 'openai'}
      onStartVoice={() =>
        void ensureMicrophone().then((ready) => {
          if (ready) return controllerRef.current?.start();
        })
      }
      onEndVoice={() => void controllerRef.current?.end()}
      onInterruptVoice={() => controllerRef.current?.interrupt()}
      onPushToTalk={() => void togglePushToTalk()}
      onDictate={togglePushToTalk}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
