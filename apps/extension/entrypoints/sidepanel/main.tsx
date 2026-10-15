import { StrictMode, useEffect, useRef, useState } from 'react';
import { ProviderSelectionSchema, type ControllerMessage, type ProviderSelection } from '@nudge/contracts';
import { createRoot } from 'react-dom/client';

import { SidePanel } from '../../src/components/SidePanel';
import { ServerClient } from '../../src/api/server-client';
import type { PortLike } from '../../src/agent/panel-bridge';
import { ControllerClient } from '../../src/panel/controller-client';
import { useNudgeStore } from '../../src/state/use-nudge-store';
import { PushToTalkTransport } from '../../src/voice/push-to-talk-transport';
import {
  browserRealtimeDependencies,
  createRealtimeVoiceTransport,
} from '../../src/voice/realtime-transport';
import { VoiceSessionController } from '../../src/voice/voice-session-controller';
import { createVoiceTaskBridge } from '../../src/voice/voice-task-bridge';
import { openMicrophoneSetup, probeMicrophone } from '../../src/permissions/microphone';
import { TabRegistry } from '../../src/tabs/tab-registry';
import { reconcileProviderSelection } from '../../src/providers/provider-selection';
import '../../src/styles/app.css';

const client = new ServerClient(
  import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
  import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
);
const controller = new ControllerClient(() => browser.runtime.connect({ name: 'nudge-panel' }) as unknown as PortLike);
const tabRegistry = new TabRegistry();

const STATUS: Record<string, string> = {
  idle: 'Ready',
  planning: 'Understanding your request…',
  running: 'Working…',
  waiting_for_page: 'Waiting for the page…',
  waiting_for_user: 'Waiting for you',
  waiting_for_confirmation: 'Waiting for your OK',
  paused: 'Paused',
  completed: 'Done',
  partially_completed: 'Partly done',
  failed: 'Stopped — could not finish',
  cancelled: 'Stopped',
};

/** The tab the user is looking at — never the side panel itself. */
async function originTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined && /^https?:/.test(tab.url ?? '')) return tab.id;
  const tabs = await browser.tabs.query({ active: true });
  return tabs.find((candidate) => /^https?:/.test(candidate.url ?? ''))?.id;
}

function App() {
  const state = useNudgeStore();
  const voiceRef = useRef<VoiceSessionController | undefined>(undefined);
  const voiceTransportRef = useRef<ReturnType<typeof createRealtimeVoiceTransport> | undefined>(undefined);
  const announced = useRef(new Set<string>());
  const pushToTalkRef = useRef(new PushToTalkTransport((audio, signal) => client.transcribe(audio, signal)));
  const [pushRecording, setPushRecording] = useState(false);
  const [providerSelection, setProviderSelection] = useState<ProviderSelection>({ provider: 'openai' });
  const [providerHealth, setProviderHealth] = useState<Awaited<ReturnType<typeof client.getProviderHealth>>>();

  const assistant = (text: string) =>
    useNudgeStore.getState().addTurn({ id: crypto.randomUUID(), role: 'assistant', text: text.slice(0, 4_000), createdAt: new Date().toISOString() });

  const onControllerMessage = (message: ControllerMessage) => {
    const store = useNudgeStore.getState();
    if (message.type === 'state') {
      const task = message.task;
      store.setController(task);
      store.setStatus(STATUS[task.status] ?? 'Working…');
      const key = (suffix: string) => `${task.taskId ?? 'none'}:${suffix}`;
      if (task.pendingQuestion && !announced.current.has(key(`q:${task.pendingQuestion}`))) {
        announced.current.add(key(`q:${task.pendingQuestion}`));
        assistant(task.pendingQuestion);
      }
      if (task.report && !announced.current.has(key('report'))) {
        announced.current.add(key('report'));
        assistant(task.report.summary);
      }
      return;
    }
    if (message.type === 'milestone') {
      store.setStatus(message.text.slice(0, 200));
      voiceTransportRef.current?.speakMilestone?.(message.text);
      return;
    }
    if (message.type === 'export_ready') {
      const bytes = Uint8Array.from(atob(message.dataBase64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: message.mime }));
      store.addExport({ filename: message.filename, url });
      return;
    }
    if (message.type === 'need_capability') store.setCapabilityReason(message.reason);
  };

  const instruct = async (text: string, source: 'text' | 'voice') => {
    useNudgeStore.getState().addTurn({ id: crypto.randomUUID(), role: 'user', text, createdAt: new Date().toISOString() });
    controller.instruct(text, source, await originTabId());
  };

  const bridge = createVoiceTaskBridge({ instruct: (text) => void instruct(text, 'voice') });

  if (!voiceRef.current) {
    const transport = createRealtimeVoiceTransport(browserRealtimeDependencies());
    voiceTransportRef.current = transport;
    voiceRef.current = new VoiceSessionController(transport, (signal) => client.issueRealtimeSession(signal), (event) => {
      bridge(event);
      const current = useNudgeStore.getState();
      if (event.type === 'state') current.setVoiceState(event.state);
      if (event.type === 'transcript') current.setVoiceTranscript(event.text);
      if (event.type === 'error') current.setStatus(event.message);
    });
  }

  const providerVision = (selection: ProviderSelection, health = providerHealth) =>
    selection.provider === 'openai'
      ? true
      : Boolean((health?.ollama as { modelCapabilities?: Record<string, { vision: boolean }> } | undefined)?.modelCapabilities?.[selection.model]?.vision);

  const selectProvider = async (selection: ProviderSelection) => {
    await client.setProviderSelection(selection);
    await browser.storage.local.set({ providerSelection: selection, providerVision: providerVision(selection) });
    setProviderSelection(selection);
    state.setStatus(selection.provider === 'ollama' ? `Using local Ollama: ${selection.model}` : 'Using OpenAI.');
  };

  useEffect(() => {
    controller.connect(onControllerMessage);
    void state.hydrateHistory();
    void browser.storage.local.get('providerSelection').then(async ({ providerSelection: saved }) => {
      const parsed = ProviderSelectionSchema.safeParse(saved);
      const selection = parsed.success ? parsed.data : { provider: 'openai' as const };
      const health = await client.getProviderHealth(selection.provider === 'ollama' ? selection.baseUrl : undefined);
      const available = reconcileProviderSelection(selection, health);
      setProviderHealth(health);
      setProviderSelection(available);
      await client.setProviderSelection(available);
      await browser.storage.local.set({ providerSelection: available, providerVision: providerVision(available, health) });
      if (JSON.stringify(available) !== JSON.stringify(selection)) {
        state.setStatus(available.provider === 'openai' ? 'Ollama has no available model. Using OpenAI.' : `Using local Ollama: ${available.model}`);
      }
    });
    if (import.meta.env.WXT_PUBLIC_NUDGE_E2E === '1') {
      // Test-only hooks for the Playwright harness (e2e builds only).
      Object.assign(window, {
        __nudgeTest: {
          injectTranscript: (text: string) => bridge({ type: 'transcript', role: 'user', text, final: true }),
          instruct: (text: string, origin?: number) => {
            useNudgeStore.getState().addTurn({ id: crypto.randomUUID(), role: 'user', text, createdAt: new Date().toISOString() });
            controller.instruct(text, 'text', origin);
          },
          confirm: (previewId: string, approved: boolean) => controller.confirm(previewId, approved),
          control: (action: 'stop' | 'pause' | 'resume' | 'continue_budget') => controller.control(action),
          exportRecords: (format: 'csv' | 'xlsx') => controller.requestExport(format),
          state: () => useNudgeStore.getState().controller,
          exports: () => useNudgeStore.getState().exports,
        },
      });
    }
    return () => {
      controller.close();
      void voiceRef.current?.end();
      void pushToTalkRef.current.cancel();
    };
  }, []);

  const ensureMicrophone = async () => {
    const setup = await browser.storage.local.get('microphoneSetupCompleted');
    if (!setup.microphoneSetupCompleted) {
      await openMicrophoneSetup();
      state.setStatus('Finish microphone setup in the new tab, then try again.');
      return false;
    }
    if ((await probeMicrophone()) !== 'granted') {
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
      }
      setPushRecording(false);
      const text = await pushToTalkRef.current.stop();
      state.setStatus(text ? 'Dictation ready to review.' : 'No speech detected.');
      return text;
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
      controller={state.controller}
      exports={state.exports}
      capabilityReason={state.capabilityReason}
      providerSelection={providerSelection}
      providerHealth={providerHealth}
      onProviderSelection={(selection) => void selectProvider(selection)}
      onRefreshProviders={() =>
        void client
          .getProviderHealth(providerSelection.provider === 'ollama' ? providerSelection.baseUrl : undefined)
          .then(setProviderHealth)
      }
      onApproveFallback={() => controller.approveFallback(true)}
      onDeclineFallback={() => controller.approveFallback(false)}
      onConfirm={(previewId, approved) => controller.confirm(previewId, approved)}
      onContinue={() => controller.control('continue_budget')}
      onRetryCapability={() => {
        state.setCapabilityReason(undefined);
        controller.capabilityGranted();
      }}
      onDismissCapability={() => state.setCapabilityReason(undefined)}
      onExport={(format) => controller.requestExport(format)}
      actions={state.actions}
      onSend={(text) => void instruct(text, 'text')}
      onStop={() => controller.control('stop')}
      onSaveKey={(key) =>
        void client
          .setProviderKey(key)
          .then(() => state.setStatus('Using your key for this backend session.'))
          .catch((error: unknown) => state.setStatus(error instanceof Error ? error.message : 'Could not save key.'))
      }
      onClearKey={() =>
        void client
          .clearProviderKey()
          .then(() => state.setStatus('Using the local default key.'))
          .catch((error: unknown) => state.setStatus(error instanceof Error ? error.message : 'Could not clear key.'))
      }
      onClearHistory={state.clearHistory}
      onOpenSource={(source) =>
        void tabRegistry.resolveSource(source).then(async (resolved) => {
          if (resolved.kind === 'existing' && resolved.tab) await tabRegistry.activate(resolved.tab.tabId);
          else await tabRegistry.open(resolved.url);
        })
      }
      voiceState={state.voiceState}
      voiceTranscript={state.voiceTranscript}
      showRealtimeVoice={providerSelection.provider === 'openai'}
      onStartVoice={() =>
        void ensureMicrophone().then((ready) => {
          if (ready) return voiceRef.current?.start();
        })
      }
      onEndVoice={() => void voiceRef.current?.end()}
      onInterruptVoice={() => voiceRef.current?.interrupt()}
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
