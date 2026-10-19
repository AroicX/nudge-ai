import { parseDeferredTask } from '../../src/agent/deferred-tasks';
import { directDestination } from '@nudge/core';
import { StrictMode, useEffect, useRef, useState } from 'react';
import {
  ProviderSelectionSchema,
  type ControllerMessage,
  type ScheduledTask,
  type ProviderSelection,
  type SourceReference,
} from '@nudge/contracts';
import { createRoot } from 'react-dom/client';

import { fullPageUrl, readPageMode, resolvePageSource } from '../../src/panel/page-mode';
import { MemoryClient } from '../../src/api/memory-client';
import { useMemoryWorkspace } from '../../src/panel/use-memory-workspace';
import { isContinuationRequest, isConversationRequest, resumeBrowserInstruction } from '../../src/panel/message-routing';
import { openContinuationPanel } from '../../src/panel/continuation-panel';
import { SidePanel } from '../../src/components/SidePanel';
import { ServerClient } from '../../src/api/server-client';
import type { PortLike } from '../../src/agent/panel-bridge';
import { ControllerClient } from '../../src/panel/controller-client';
import { useNudgeStore } from '../../src/state/use-nudge-store';
import {
  browserLocalAudio,
  localBrowserInstruction,
  LocalVoiceConversation,
} from '../../src/voice/local-voice';
import { PushToTalkTransport } from '../../src/voice/push-to-talk-transport';
import {
  browserRealtimeDependencies,
  createRealtimeVoiceTransport,
} from '../../src/voice/realtime-transport';
import { VoiceSessionController } from '../../src/voice/voice-session-controller';
import { createVoiceTaskBridge } from '../../src/voice/voice-task-bridge';
import { createVoiceConversation } from '../../src/voice/voice-conversation';
import { openMicrophoneSetup, probeMicrophone } from '../../src/permissions/microphone';
import { TabRegistry } from '../../src/tabs/tab-registry';
import { parseNativeBrowserCommand } from '../../src/tabs/native-browser';
import {
  readSharedProvider,
  sharedProviderKeys,
  writeSharedProvider,
  type ProviderLock,
} from '../../src/panel/shared-provider';
import { VoiceProviderGate } from '../../src/providers/voice-provider-gate';
import { reconcileProviderSelection } from '../../src/providers/provider-selection';
import { ChatGptCompanion, CHATGPT_HOST, type ChatGptAccount } from '../../src/chatgpt/companion';
import { planMessages, routeEligibleText, withImages } from '../../src/chatgpt/text-route';
import {
  canvasCodec,
  imageProblem,
  imageSupport,
  prepareImage,
  type PendingImage,
} from '../../src/chat/image-attachments';
import '../../src/styles/app.css';

const client = new ServerClient(
  import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
  import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
);
const memoryClient = new MemoryClient(
  import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
  import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
);
const controller = new ControllerClient(
  () => browser.runtime.connect({ name: 'nudge-panel' }) as unknown as PortLike,
);
const tabRegistry = new TabRegistry();
const pageMode = readPageMode(window.location.search);

const STATUS: Record<string, string> = {
  idle: 'Ready',
  planning: 'Understanding your request…',
  running: 'Working…',
  waiting_for_page: 'Waiting for the page…',
  waiting_for_user: 'Waiting for you',
  waiting_for_confirmation: 'Waiting for your OK',
  paused: 'Paused',
  completed: 'Ready',
  partially_completed: 'Partly done',
  failed: 'Stopped — could not finish',
  cancelled: 'Stopped',
};

function App() {
  const state = useNudgeStore();
  const memory = useMemoryWorkspace(memoryClient);
  const [chatPending, setChatPending] = useState(false);
  const [chatGptAccounts, setChatGptAccounts] = useState<ChatGptAccount[]>([]);
  const [chatGptActive, setChatGptActive] = useState<string>();
  const [chatGptError, setChatGptError] = useState<string>();
  const [images, setImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string>();
  const imagesRef = useRef<PendingImage[]>([]);
  imagesRef.current = images;
  const addImages = (files: File[]) => {
    setImageError(undefined);
    let count = imagesRef.current.length;
    for (const file of files) {
      const problem = imageProblem(file, count);
      if (problem) {
        setImageError(problem);
        continue;
      }
      count += 1;
      const id = crypto.randomUUID();
      setImages((current) => [...current, { id, name: file.name, status: 'preparing' }]);
      void prepareImage(file, canvasCodec)
        .then(({ input, turn }) =>
          setImages((current) => current.map((item) => (item.id === id ? { ...item, status: 'ready', input, turn } : item))),
        )
        .catch((error: unknown) =>
          setImages((current) =>
            current.map((item) =>
              item.id === id
                ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Could not read this image.' }
                : item,
            ),
          ),
        );
    }
  };
  const removeImage = (id: string) => {
    setImageError(undefined);
    setImages((current) => current.filter((item) => item.id !== id));
  };
  const [chatGptBusy, setChatGptBusy] = useState(false);
  const [chatGptWelcome, setChatGptWelcome] = useState(false);
  const [chatGptLimit, setChatGptLimit] = useState(false);
  const [planModels, setPlanModels] = useState<Array<{ slug: string; displayName: string }>>([]);
  const chatAbort = useRef<AbortController | undefined>(undefined);
  const chatGpt = useRef(
    new ChatGptCompanion(
      () => browser.runtime.connectNative(CHATGPT_HOST) as never,
      browser.runtime.id,
    ),
  );
  useEffect(() => {
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && 'nudgeCancelChatReply' in changes) chatAbort.current?.abort();
      if (area === 'local' && 'nudgeChatReplyPending' in changes)
        setChatPending(
          typeof changes.nudgeChatReplyPending?.newValue === 'number' &&
            changes.nudgeChatReplyPending.newValue > Date.now(),
        );
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.local
      .get('nudgeChatReplyPending')
      .then((saved) =>
        setChatPending(
          typeof saved.nudgeChatReplyPending === 'number' &&
            saved.nudgeChatReplyPending > Date.now(),
        ),
      );
    return () => {
      browser.storage.onChanged.removeListener(changed);
      if (chatAbort.current) {
        chatAbort.current.abort();
        void browser.storage.local.set({ nudgeChatReplyPending: false });
      }
    };
  }, []);
  const sourceTabId = useRef(pageMode.sourceTabId);
  const [linkedPage, setLinkedPage] = useState<SourceReference>();
  const panelWindowId = useRef<number | undefined>(undefined);
  useEffect(() => {
    void browser.windows.getCurrent().then((window) => {
      panelWindowId.current = window.id;
    });
  }, []);
  const showContinuation = () =>
    openContinuationPanel(
      pageMode.fullPage,
      panelWindowId.current,
      (options) => browser.sidePanel.open(options),
      () =>
        state.setStatus(
          'Click the Nudge extension icon on the new tab to continue in the side panel.',
        ),
    );
  const currentSource = () =>
    resolvePageSource(tabRegistry, pageMode.fullPage, sourceTabId.current);
  useEffect(() => {
    if (!pageMode.fullPage) return;
    const refresh = () => {
      void currentSource()
        .then(setLinkedPage)
        .catch(() => setLinkedPage(undefined));
    };
    refresh();
    const removeUpdated = tabRegistry.onUpdated((id) => {
      if (id === sourceTabId.current) refresh();
    });
    const removeClosed = tabRegistry.onRemoved((id) => {
      if (id === sourceTabId.current) refresh();
    });
    return () => {
      removeUpdated();
      removeClosed();
    };
  }, []);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const localVoiceRef = useRef<LocalVoiceConversation | undefined>(undefined);
  const localProviderRef = useRef(false);
  const voiceProviderGate = useRef(new VoiceProviderGate());
  const providerRevision = useRef(0);
  const appliedProvider = useRef<ProviderSelection | undefined>(undefined);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const voiceRef = useRef<VoiceSessionController | undefined>(undefined);
  const voiceTransportRef = useRef<ReturnType<typeof createRealtimeVoiceTransport> | undefined>(
    undefined,
  );
  const voiceConversationRef = useRef<ReturnType<typeof createVoiceConversation> | undefined>(
    undefined,
  );
  const voiceSource = useRef<Promise<SourceReference | undefined> | undefined>(undefined);
  const announced = useRef(new Set<string>());
  const pushToTalkRef = useRef(
    new PushToTalkTransport((audio, signal) =>
      client.transcribe(audio, signal, voiceProviderGate.current.requireLocal()),
    ),
  );
  const [pushRecording, setPushRecording] = useState(false);
  const [providerPending, setProviderPending] = useState(false);
  const [providerError, setProviderError] = useState<string>();
  const [providerSelection, setProviderSelection] = useState<ProviderSelection>({
    provider: 'openai',
  });
  const [providerHealth, setProviderHealth] =
    useState<Awaited<ReturnType<typeof client.getProviderHealth>>>();

  const assistant = (
    text: string,
    sources: SourceReference[] = [],
    id: string = crypto.randomUUID(),
  ) =>
    useNudgeStore.getState().addTurn({
      id,
      role: 'assistant',
      text: text.slice(0, 4_000),
      createdAt: new Date().toISOString(),
      sources,
    });

  const onControllerMessage = (message: ControllerMessage) => {
    const store = useNudgeStore.getState();
    if (message.type === 'schedules') {
      setScheduledTasks(message.jobs);
      return;
    }
    if (message.type === 'state') {
      const task = message.task;
      store.setController(task);
      store.setStatus(STATUS[task.status] ?? 'Working…');
      const key = (suffix: string) => `task:${task.taskId ?? 'none'}:${suffix}`.slice(0, 120);
      const belongsToChat = Boolean(
        task.taskId &&
        useNudgeStore.getState().conversation.some((turn) => turn.progress?.taskId === task.taskId),
      );
      if (
        belongsToChat &&
        task.pendingQuestion &&
        !announced.current.has(key(`q:${task.pendingQuestion}`))
      ) {
        announced.current.add(key(`q:${task.pendingQuestion}`));
        const hash = Array.from(task.pendingQuestion)
          .reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) | 0, 0)
          .toString(36);
        assistant(task.pendingQuestion, task.sources ?? [], key(`question:${hash}`));
      }
      if (belongsToChat && task.report && !announced.current.has(key('report'))) {
        announced.current.add(key('report'));
        assistant(task.report.summary, task.sources ?? [], key('report'));
      }
      return;
    }
    if (message.type === 'milestone') {
      const current = useNudgeStore.getState().controller?.status;
      if (current === 'completed') store.setStatus('Ready');
      else if (
        !current ||
        !['partially_completed', 'failed', 'cancelled'].includes(current)
      )
        store.setStatus(message.text.slice(0, 200));
      if (localProviderRef.current) localVoiceRef.current?.speakMilestone(message.text);
      else voiceTransportRef.current?.speakMilestone?.(message.text);
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

  const instruct = async (text: string, source: 'text' | 'voice', recordTurn = true) => {
    const snapshot = useNudgeStore.getState();
    const previousBrowserTask = [...snapshot.conversation]
      .reverse()
      .find((turn) => turn.role === 'user' && turn.progress && !isContinuationRequest(turn.text))?.text;
    const resumed = resumeBrowserInstruction(text, previousBrowserTask, snapshot.controller?.status);
    const command = resumed ?? text;
    // Images are answered in chat; they are never sent to the browser planner.
    const attached = source === 'text' ? imagesRef.current.filter((item) => item.status === 'ready' && item.input && item.turn) : [];
    if (attached.length && !isConversationRequest(text, snapshot.controller?.status))
      state.setStatus('Images are answered in chat. Browser tasks cannot use attached images yet.');
    if (
      source === 'text' &&
      !resumed &&
      (attached.length > 0 || isConversationRequest(text, snapshot.controller?.status))
    ) {
      if (chatPending || chatAbort.current) return;
      if (!memory.activeId || memory.loading) {
        state.setStatus('Your local chat storage is still loading. Please try again.');
        return;
      }
      await navigator.locks.request(
        'nudge-conversation-reply',
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            state.setStatus(
              'A reply is already in progress. Wait for it or stop it before sending another message.',
            );
            return;
          }
          const chatId = memory.activeId!;
          const selection = appliedProvider.current;
          if (!voiceProviderGate.current.ready || !selection) {
            state.setStatus('Provider settings are updating. Please try again in a moment.');
            return;
          }
          const route = routeEligibleText({
            text,
            taskStatus: useNudgeStore.getState().controller?.status,
            selection,
          });
          const routed =
            attached.length && route.kind === 'browser' && selection.provider === 'chatgpt'
              ? ({ kind: 'plan', accountId: selection.accountId, model: selection.model } as const)
              : attached.length && route.kind === 'browser' && selection.provider !== 'chatgpt'
                ? ({ kind: 'conversation', provider: selection.provider } as const)
                : route;
          if (routed.kind !== 'plan' && routed.kind !== 'conversation') return;
          if (attached.length) {
            // Never switch provider or billing to read images.
            const support = imageSupport(selection, providerVision(selection));
            if (!support.ok) {
              setImageError(support.reason);
              state.setStatus(support.reason);
              return;
            }
          }
          const abort = new AbortController();
          chatAbort.current = abort;
          setChatPending(true);
          let replyId = '';
          try {
            await browser.storage.local.set({ nudgeChatReplyPending: Date.now() + 180_000 });
            useNudgeStore.getState().addTurn({
              id: crypto.randomUUID(),
              role: 'user',
              text,
              createdAt: new Date().toISOString(),
              ...(attached.length ? { images: attached.map((item) => item.turn!) } : {}),
            });
            if (attached.length) {
              setImages((current) => current.filter((item) => !attached.some((sent) => sent.id === item.id)));
              setImageError(undefined);
            }
            useNudgeStore.setState({ pendingTaskTurnId: undefined });
            state.setStatus('Thinking…');
            await memory.flush();
            if (routed.kind === 'plan') {
              const context = await memoryClient.context(text, abort.signal);
              const bindingKey = `nudgeChatGptAccount:${chatId}`;
              const stored = await browser.storage.local.get(bindingKey);
              const bound =
                typeof stored[bindingKey] === 'string' ? stored[bindingKey] : undefined;
              const history = useNudgeStore
                .getState()
                .conversation.slice(0, -1)
                .map((turn) => ({ role: turn.role, text: turn.text }));
              const planned = planMessages({
                history,
                question: text,
                ...(typeof bound === 'string' ? { boundAccountId: bound } : {}),
                activeAccountId: routed.accountId,
              });
              if (!planned.ok) {
                state.setStatus(planned.message);
                return;
              }
              replyId = crypto.randomUUID();
              let assembled = '';
              await chatGpt.current.respond({
                accountId: routed.accountId,
                model: routed.model,
                instructions: context.instructions,
                messages: withImages(planned.messages, attached.map((item) => item.input!)),
                signal: abort.signal,
                onDelta: (delta) => {
                  assembled = (assembled + delta).slice(0, 4000);
                  const store = useNudgeStore.getState();
                  if (!store.conversation.some((turn) => turn.id === replyId)) {
                    store.addTurn({
                      id: replyId,
                      role: 'assistant',
                      text: assembled,
                      createdAt: new Date().toISOString(),
                    });
                  } else store.patchTurn(replyId, assembled);
                },
              });
              if (!abort.signal.aborted) {
                if (!assembled.trim()) throw new Error('ChatGPT returned an empty reply.');
                await browser.storage.local.set({ [bindingKey]: routed.accountId });
                await memory.flush();
                state.setStatus('Using ChatGPT plan.');
              }
            } else {
              const reply = await memoryClient.chat(
                chatId,
                text,
                routed.provider,
                abort.signal,
                attached.map((item) => item.input!),
              );
              if (!abort.signal.aborted) {
                const references = reply.sources?.map((source) => source.title).filter(Boolean);
                assistant(
                  reply.text +
                    (references?.length
                      ? `\n\nReferences: ${Array.from(new Set(references)).join('; ')}`
                      : ''),
                );
                await memory.flush();
                state.setStatus('Ready');
              }
            }
          } catch (error) {
            const message = abort.signal.aborted
              ? 'Stopped'
              : error instanceof Error
                ? error.message
                : 'Could not answer right now.';
            if (replyId && !abort.signal.aborted)
              useNudgeStore.getState().patchTurn(replyId, message);
            if (message.includes('Usage limit reached')) setChatGptLimit(true);
            if (!abort.signal.aborted) setChatGptError(message);
            state.setStatus(message);
          } finally {
            chatAbort.current = undefined;
            setChatPending(false);
            await browser.storage.local.set({ nudgeChatReplyPending: false });
          }
        },
      );
      return;
    }

    const captured = source === 'voice' && !recordTurn ? voiceSource.current : undefined;
    if (source === 'voice') voiceSource.current = undefined;
    try {
      const linkedTab = await (captured ?? currentSource());
      if (recordTurn) {
        useNudgeStore.getState().addTurn({
          id: crypto.randomUUID(),
          role: 'user',
          text,
          createdAt: new Date().toISOString(),
          sources: linkedTab ? [linkedTab] : [],
        });
      }
      if (
        !linkedTab &&
        !parseNativeBrowserCommand(text) &&
        !directDestination(text) &&
        parseDeferredTask(text, Date.now()).kind === 'ordinary'
      ) {
        assistant(
          'Open a website in this browser window first, then try the request again. I could not identify a page to work on.',
        );
        return;
      }
      controller.instruct(command, source, linkedTab?.tabId);
    } catch {
      useNudgeStore
        .getState()
        .setStatus('Could not identify the current browser tab. Please try again.');
    }
  };

  const bridge = createVoiceTaskBridge({ instruct: (text) => void instruct(text, 'voice', false) });

  if (!voiceConversationRef.current) {
    voiceConversationRef.current = createVoiceConversation({
      addTurn: (turn) => {
        useNudgeStore.getState().addTurn(turn);
        if (turn.role === 'user') {
          // Capture once at transcript finalization; the source chip and task use the same page.
          const captured = currentSource().catch(() => undefined);
          voiceSource.current = captured;
          void captured.then((source) => {
            if (source) useNudgeStore.getState().setTurnSources(turn.id, [source]);
          });
        }
      },
      setLiveTranscript: (text) => useNudgeStore.getState().setVoiceTranscript(text),
      setLiveVoiceTurn: (turn) => useNudgeStore.getState().setLiveVoiceTurn(turn),
    });
  }

  if (!voiceRef.current) {
    const transport = createRealtimeVoiceTransport(browserRealtimeDependencies());
    voiceTransportRef.current = transport;
    voiceRef.current = new VoiceSessionController(
      transport,
      (signal) => client.issueRealtimeSession(signal),
      (event) => {
        voiceConversationRef.current?.handle(event);
        bridge(event);
        const current = useNudgeStore.getState();
        if (event.type === 'state') current.setVoiceState(event.state);
        if (event.type === 'error') current.setStatus(event.message);
      },
    );
  }

  if (!localVoiceRef.current) {
    localVoiceRef.current = new LocalVoiceConversation(
      {
        health: (signal) => client.localVoiceHealth(signal),
        prepare: (signal) => client.prepareLocalVoice(signal),
        transcribe: (audio, signal) => client.transcribe(audio, signal, true),
        chat: (messages, signal) => client.localVoiceChat(messages, signal),
        chatStream: (messages, signal, onText) =>
          client.localVoiceChatStream(messages, signal, onText),
        speech: (text, signal) => client.localVoiceSpeech(text, signal),
      },
      (event) => {
        voiceConversationRef.current?.handle(event);
        if (event.type === 'state') useNudgeStore.getState().setVoiceState(event.state);
        if (event.type === 'error') useNudgeStore.getState().setStatus(event.message);
      },
      browserLocalAudio,
      (text) => {
        const taskStatus = useNudgeStore.getState().controller?.status;
        const taskActive = Boolean(
          taskStatus &&
          !['idle', 'completed', 'partially_completed', 'failed', 'cancelled'].includes(taskStatus),
        );
        const instruction = localBrowserInstruction(text, taskActive);
        if (!instruction) return false;
        void instruct(instruction, 'voice', false);
        return true;
      },
    );
  }
  const activeVoice = () =>
    !voiceProviderGate.current.ready
      ? undefined
      : voiceProviderGate.current.requireLocal()
        ? localVoiceRef.current
        : voiceRef.current;

  const providerVision = (selection: ProviderSelection, health = providerHealth) =>
    selection.provider === 'openai'
      ? true
      : selection.provider === 'chatgpt'
        ? false
        : Boolean(
          (
            health?.ollama as
              { modelCapabilities?: Record<string, { vision: boolean }> } | undefined
          )?.modelCapabilities?.[selection.model]?.vision,
        );

  const providerLock: ProviderLock = async (operation) =>
    await navigator.locks.request('nudge-provider-settings', operation);
  const stopProviderVoice = async () => {
    await Promise.all([
      voiceRef.current?.end(),
      localVoiceRef.current?.end(),
      pushToTalkRef.current.cancel(),
    ]);
    setPushRecording(false);
  };
  const syncProviderFromStorage = async (): Promise<boolean> => {
    const revision = ++providerRevision.current;
    const shared = await readSharedProvider(browser.storage.local);
    if (revision !== providerRevision.current) return false;
    if (
      !shared.pending &&
      !shared.error &&
      shared.selection &&
      voiceProviderGate.current.ready &&
      JSON.stringify(appliedProvider.current) === JSON.stringify(shared.selection)
    )
      return true;
    voiceProviderGate.current.beginSwitch();
    setProviderPending(shared.pending);
    setProviderError(shared.error);
    await stopProviderVoice();
    if (revision !== providerRevision.current) return false;
    if (shared.pending || shared.error || !shared.selection) {
      appliedProvider.current = undefined;
      voiceProviderGate.current.finishSwitch();
      return false;
    }
    appliedProvider.current = shared.selection;
    localProviderRef.current = shared.selection.provider === 'ollama';
    setProviderSelection(shared.selection);
    voiceProviderGate.current.finishSwitch(shared.selection);
    state.setStatus(
      shared.selection.provider === 'ollama'
        ? `Using local Ollama: ${shared.selection.model}`
        : shared.selection.provider === 'chatgpt'
          ? 'Using ChatGPT plan.'
          : 'Using OpenAI.',
    );
    return true;
  };
  const selectProvider = async (selection: ProviderSelection) => {
    voiceProviderGate.current.beginSwitch();
    setProviderPending(true);
    setProviderError(undefined);
    state.setStatus('Updating provider settings…');
    try {
      await stopProviderVoice();
      await writeSharedProvider(
        providerLock,
        browser.storage.local,
        (next) => client.setProviderSelection(next),
        async () => ({ selection, vision: providerVision(selection) }),
      );
      await syncProviderFromStorage();
    } catch (error) {
      await syncProviderFromStorage();
      state.setStatus(
        error instanceof Error ? error.message : 'Could not update provider settings.',
      );
    }
  };

  const applyChatGpt = async (status: { accounts?: ChatGptAccount[]; activeAccountId?: string }) => {
    const accounts = status.accounts ?? [];
    setChatGptAccounts(accounts);
    setChatGptActive(status.activeAccountId);
    const active = accounts.find((account) => account.id === status.activeAccountId);
    if (!active?.signedIn || !active.planUsage) {
      setPlanModels([]);
      return;
    }
    const models = await chatGpt.current.models(active.id);
    setPlanModels(models);
    const seen = await browser.storage.local.get('nudgeChatGptWelcomeSeen');
    if (!seen.nudgeChatGptWelcomeSeen) setChatGptWelcome(true);
  };
  const refreshChatGpt = async () => {
    await applyChatGpt(await chatGpt.current.status());
  };
  const runChatGpt = async (
    work: () => Promise<{ accounts?: ChatGptAccount[]; activeAccountId?: string }>,
  ) => {
    setChatGptBusy(true);
    setChatGptError(undefined);
    setChatGptLimit(false);
    try {
      await applyChatGpt(await work());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ChatGPT sign-in failed.';
      setChatGptError(message);
      state.setStatus(message);
    } finally {
      setChatGptBusy(false);
    }
  };

  useEffect(() => {
    if (!pageMode.fullPage) return;
    void refreshChatGpt().catch((error: unknown) => {
      setChatGptError(
        error instanceof Error
          ? error.message
          : 'Install the Nudge ChatGPT companion, then reload the extension.',
      );
    });
  }, []);

  useEffect(() => {
    controller.connect(onControllerMessage);

    const onProviderStorage = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local' || !sharedProviderKeys.some((key) => key in changes)) return;
      chatAbort.current?.abort();
      // Invalidate synchronously before reading the newly published shared choice.
      voiceProviderGate.current.beginSwitch();
      void syncProviderFromStorage().catch((error: unknown) => {
        voiceProviderGate.current.finishSwitch();
        setProviderError(
          error instanceof Error ? error.message : 'Could not sync provider settings.',
        );
      });
    };
    browser.storage.onChanged.addListener(onProviderStorage);
    void writeSharedProvider(
      providerLock,
      browser.storage.local,
      (selection) => client.setProviderSelection(selection),
      async () => {
        // Read inside the shared lock so a second panel cannot overwrite a newer choice.
        const { providerSelection: saved } = await browser.storage.local.get('providerSelection');
        const parsed = ProviderSelectionSchema.safeParse(saved);
        const selection = parsed.success ? parsed.data : { provider: 'openai' as const };
        const health = await client.getProviderHealth(
          selection.provider === 'ollama' ? selection.baseUrl : undefined,
        );
        setProviderHealth(health);
        const available = reconcileProviderSelection(selection, health);
        return { selection: available, vision: providerVision(available, health) };
      },
    )
      .then(() => syncProviderFromStorage())
      .catch((error: unknown) => {
        state.setStatus(
          error instanceof Error ? error.message : 'Could not load provider settings.',
        );
      });
    if (import.meta.env.WXT_PUBLIC_NUDGE_E2E === '1') {
      // Test-only hooks for the Playwright harness (e2e builds only).
      Object.assign(window, {
        __nudgeTest: {
          injectTranscript: (text: string) =>
            bridge({ type: 'transcript', role: 'user', text, final: true }),
          instruct: (text: string, origin?: number) => {
            useNudgeStore.getState().addTurn({
              id: crypto.randomUUID(),
              role: 'user',
              text,
              createdAt: new Date().toISOString(),
            });
            controller.instruct(text, 'text', origin);
          },
          confirm: (previewId: string, approved: boolean) =>
            controller.confirm(previewId, approved),
          control: (action: 'stop' | 'pause' | 'resume' | 'continue_budget') =>
            controller.control(action),
          exportRecords: (format: 'csv' | 'xlsx') => controller.requestExport(format),
          state: () => useNudgeStore.getState().controller,
          exports: () => useNudgeStore.getState().exports,
        },
      });
    }
    return () => {
      browser.storage.onChanged.removeListener(onProviderStorage);
      controller.close();
      void voiceRef.current?.end();
      void localVoiceRef.current?.end();
      void pushToTalkRef.current.cancel();
    };
  }, []);

  const ensureMicrophone = async () => {
    if (!(await syncProviderFromStorage())) {
      state.setStatus('Voice is waiting for your saved provider settings.');
      return false;
    }
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
      if (!voiceProviderGate.current.ready) {
        state.setStatus('Voice is waiting for your saved provider settings.');
        return '';
      }
      if (activeVoice()?.active) await activeVoice()?.end();
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

  const controllerForChat =
    state.controller &&
    (!['completed', 'partially_completed', 'failed', 'cancelled'].includes(
      state.controller.status,
    ) ||
      state.conversation.some((turn) => turn.progress?.taskId === state.controller?.taskId))
      ? state.controller
      : undefined;
  return (
    <SidePanel
      images={images}
      imageError={imageError}
      onAddImages={addImages}
      onRemoveImage={removeImage}
      allowTaskUpdates={!chatPending}
      memoryWorkspace={memory}
      fullPage={pageMode.fullPage}
      linkedPage={linkedPage}
      onExpand={() => {
        void currentSource()
          .then((source) =>
            browser.tabs.create({
              url: fullPageUrl(browser.runtime.getURL('/sidepanel.html'), source?.tabId),
            }),
          )
          .catch(() => state.setStatus('Could not open the full-page chat. Please try again.'));
      }}
      busy={
        chatPending ||
        ['planning', 'running', 'waiting_for_page'].includes(state.controller?.status ?? '')
      }
      scheduledTasks={scheduledTasks}
      onCancelSchedule={(id) => controller.cancelSchedule(id)}
      onManageSchedule={(id, action, changes) => controller.manageSchedule(id, action, changes)}
      status={state.status}
      conversation={state.conversation}
      timeline={state.timeline}
      controller={controllerForChat}
      exports={state.exports}
      capabilityReason={state.capabilityReason}
      providerPending={providerPending}
      providerError={providerError}
      providerSelection={providerSelection}
      providerHealth={providerHealth}
      planModels={pageMode.fullPage ? planModels : undefined}
      chatGpt={
        pageMode.fullPage
          ? {
              accounts: chatGptAccounts,
              activeAccountId: chatGptActive,
              busy: chatGptBusy,
              error: chatGptError,
              limitReached: chatGptLimit,
              welcome: chatGptWelcome,
              connected: Boolean(
                chatGptAccounts.find((account) => account.id === chatGptActive)?.signedIn,
              ),
              onConnect: () =>
                void runChatGpt(async () => {
                  const result = await chatGpt.current.connectAccount();
                  if (result.account?.planUsage) {
                    const models = await chatGpt.current.models(result.account.id);
                    setPlanModels(models);
                    const model = models[0];
                    if (model)
                      await selectProvider({
                        provider: 'chatgpt',
                        accountId: result.account.id,
                        model: model.slug,
                      });
                  }
                  return result;
                }),
              onReconnect: (accountId) =>
                void runChatGpt(() => chatGpt.current.connectAccount({ accountId })),
              onAddAccount: () =>
                void runChatGpt(() => chatGpt.current.connectAccount({ newAccount: true })),
              onEnablePlan: (accountId) =>
                void runChatGpt(() => chatGpt.current.connectAccount({ accountId, enablePlan: true })),
              onDisconnect: (accountId) =>
                void runChatGpt(async () => {
                  const result = await chatGpt.current.disconnectAccount(accountId);
                  if (!result.revocationConfirmed)
                    setChatGptError(
                      'Local ChatGPT access was cleared. Remote revocation was not confirmed. You can also disconnect Nudge in ChatGPT settings.',
                    );
                  return result;
                }),
              onSelect: (accountId) =>
                void runChatGpt(async () => {
                  const result = await chatGpt.current.selectAccount(accountId);
                  const account = result.accounts?.find((item) => item.id === accountId);
                  if (account?.signedIn && account.planUsage) {
                    const models = await chatGpt.current.models(accountId);
                    setPlanModels(models);
                    const model = models[0];
                    if (model)
                      await selectProvider({ provider: 'chatgpt', accountId, model: model.slug });
                  }
                  return result;
                }),
              onDismissWelcome: () => {
                setChatGptWelcome(false);
                void browser.storage.local.set({ nudgeChatGptWelcomeSeen: true });
              },
              onManageUsage: () => {
                void browser.tabs.create({ url: 'https://chatgpt.com/settings/usage' });
              },
            }
          : undefined
      }
      onProviderSelection={(selection) => void selectProvider(selection)}
      onRefreshProviders={() =>
        void client
          .getProviderHealth(
            providerSelection.provider === 'ollama' ? providerSelection.baseUrl : undefined,
          )
          .then(setProviderHealth)
          .catch((error: unknown) =>
            state.setStatus(error instanceof Error ? error.message : 'Could not refresh models.'),
          )
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
      onSend={(text) => {
        if (!isConversationRequest(text, useNudgeStore.getState().controller?.status))
          showContinuation();
        if (voiceProviderGate.current.ready && activeVoice()?.active) activeVoice()?.sendText(text);
        else void instruct(text, 'text');
      }}
      onSelectTab={(number) => {
        const selected = state.controller?.tabChoices?.find((tab) => tab.number === number);
        if (pageMode.fullPage && selected) {
          sourceTabId.current = selected.tabId;
          setLinkedPage(selected);
          window.history.replaceState(null, '', fullPageUrl(window.location.href, selected.tabId));
        }
        void instruct(`tab ${number}`, 'text');
      }}
      onStop={() => {
        if (chatPending) {
          chatAbort.current?.abort();
          void browser.storage.local.set({ nudgeCancelChatReply: crypto.randomUUID() });
        } else controller.control('stop');
      }}
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
      onClearHistory={() => void memory.clearChat()}
      onOpenSource={(source) =>
        void tabRegistry.resolveSource(source).then(async (resolved) => {
          if (resolved.kind === 'existing' && resolved.tab)
            await tabRegistry.activate(resolved.tab.tabId);
          else await tabRegistry.open(resolved.url);
        })
      }
      voiceState={state.voiceState}
      voiceTranscript={state.voiceTranscript}
      liveVoiceTurn={state.liveVoiceTurn}
      showRealtimeVoice
      voiceMuted={voiceMuted}
      onMuteVoice={() => {
        const muted = !voiceMuted;
        setVoiceMuted(muted);
        activeVoice()?.setMuted(muted);
      }}
      onStartVoice={() => {
        showContinuation();
        void ensureMicrophone().then((ready) => {
          if (ready) {
            void pushToTalkRef.current.cancel();
            setPushRecording(false);
            setVoiceMuted(false);
            if (localProviderRef.current)
              state.setStatus(
                'Local voice: speak naturally or give a browser command, such as “Open YouTube”. Headphones help prevent speaker echo.',
              );
            return activeVoice()?.start();
          }
        });
      }}
      onEndVoice={() => void activeVoice()?.end()}
      onInterruptVoice={() => activeVoice()?.interrupt()}
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
