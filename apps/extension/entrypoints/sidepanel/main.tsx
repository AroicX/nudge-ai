import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { SidePanel } from '../../src/components/SidePanel';
import { ServerClient } from '../../src/api/server-client';
import { runTask, type TaskRunHandle } from '../../src/orchestration/run-task';
import { useNudgeStore } from '../../src/state/use-nudge-store';
import { PushToTalkTransport } from '../../src/voice/push-to-talk-transport';
import {
  browserRealtimeDependencies,
  createRealtimeVoiceTransport,
} from '../../src/voice/realtime-transport';
import { VoiceSessionController } from '../../src/voice/voice-session-controller';
import { createVoiceTaskBridge } from '../../src/voice/voice-task-bridge';
import { openMicrophoneSetup, probeMicrophone } from '../../src/permissions/microphone';
import '../../src/styles/app.css';

const client = new ServerClient(
  import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
  import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
);
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
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const controllerRef = useRef<VoiceSessionController | undefined>(undefined);
  const pushToTalkRef = useRef(
    new PushToTalkTransport((audio, signal) => client.transcribe(audio, signal)),
  );
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [pushRecording, setPushRecording] = useState(false);
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
  sendRef.current = (text) => void send(text);

  if (!controllerRef.current) {
    const bridge = createVoiceTaskBridge({
      submitTurn: (text) => sendRef.current(text),
      stopTask: () => activeRun?.stop(),
      reportIntent: (_name, argumentsValue) =>
        sendRef.current(
          typeof argumentsValue.goal === 'string'
            ? argumentsValue.goal
            : JSON.stringify(argumentsValue),
        ),
    });
    controllerRef.current = new VoiceSessionController(
      createRealtimeVoiceTransport(browserRealtimeDependencies()),
      (signal) => client.issueRealtimeSession(signal),
      (event) => {
        bridge(event);
        const current = useNudgeStore.getState();
        if (event.type === 'state') current.setVoiceState(event.state);
        if (event.type === 'transcript') {
          current.setVoiceTranscript(event.text);
          if (event.final && event.role === 'assistant') {
            current.addTurn({
              id: crypto.randomUUID(),
              role: 'assistant',
              text: event.text,
              createdAt: new Date().toISOString(),
            });
          }
        }
        if (event.type === 'error') current.setStatus(event.message);
      },
    );
  }

  useEffect(
    () => () => {
      void controllerRef.current?.end();
      void pushToTalkRef.current.cancel();
      activeRun?.stop();
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
      voiceState={state.voiceState}
      voiceTranscript={state.voiceTranscript}
      voiceMuted={voiceMuted}
      onStartVoice={() =>
        void ensureMicrophone().then((ready) => {
          if (ready) return controllerRef.current?.start();
        })
      }
      onEndVoice={() => void controllerRef.current?.end()}
      onMuteVoice={() => {
        const next = !voiceMuted;
        setVoiceMuted(next);
        controllerRef.current?.setMuted(next);
      }}
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
