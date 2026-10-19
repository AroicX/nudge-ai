import { ChatGptCompanion, CHATGPT_HOST } from '../src/chatgpt/companion';
import { createPlanPlannerPort } from '../src/chatgpt/planner-port';
import {
  ContentEventSchema,
  ExtensionMessageSchema,
  ProviderSelectionSchema,
  type ProviderSelection,
} from '@nudge/contracts';

import { ServerClient } from '../src/api/server-client';
import { createCdpExecutor } from '../src/agent/cdp-executor';
import {
  createChromeCheckpointPort,
  createChromeContentPort,
  createChromePlannerPort,
  createChromeScreenshotPort,
  createChromeTabsPort,
} from '../src/agent/chrome-ports';
import { OtpBroker } from '../src/agent/otp-broker';
import { createPanelBridge, type PortLike } from '../src/agent/panel-bridge';
import { DeferredTasks } from '../src/agent/deferred-tasks';
import { TaskController } from '../src/agent/task-controller';
import { executeNativeBrowserCommand, type BrowserApi } from '../src/tabs/native-browser';

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void browser.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });

  const server = new ServerClient(
    import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
    import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
  );
  let provider: 'openai' | 'ollama' = 'openai';
  let subscriptionText = false;
  let vision = true;
  let providerSelection: ProviderSelection = { provider: 'openai' };
  const loadProvider = async () => {
    const stored = await browser.storage.local.get(['providerSelection', 'providerVision']);
    const selection = ProviderSelectionSchema.safeParse(stored.providerSelection);
    providerSelection = selection.success ? selection.data : { provider: 'openai' };
    subscriptionText = providerSelection.provider === 'chatgpt';
    provider = providerSelection.provider === 'ollama' ? 'ollama' : 'openai';
    vision =
      providerSelection.provider === 'openai'
        ? true
        : providerSelection.provider === 'ollama'
          ? stored.providerVision === true
          : false;
  };
  const providerReady = loadProvider();
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') void loadProvider();
  });

  const tabs = createChromeTabsPort();
  const content = createChromeContentPort();
  const cdp = createCdpExecutor(browser.debugger as never, browser.permissions as never);
  const relay: { bridge?: ReturnType<typeof createPanelBridge> } = {};
  const companion = new ChatGptCompanion(() => browser.runtime.connectNative(CHATGPT_HOST), browser.runtime.id);
  const planner = createPlanPlannerPort(createChromePlannerPort(server), companion, () => providerSelection, (query, signal) =>
    server.agentContext(query, signal),
  );
  let userTimeZone: string | undefined;
  const loadTimeZone = async () => {
    const stored = await browser.storage.local.get('userTimeZone');
    userTimeZone = typeof stored.userTimeZone === 'string' && stored.userTimeZone ? stored.userTimeZone : undefined;
  };
  void loadTimeZone();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'userTimeZone' in changes) void loadTimeZone();
  });
  const controller = new TaskController({
    tabs,
    content,
    planner,
    screenshots: createChromeScreenshotPort(tabs, content, cdp),
    cdp,
    checkpoints: createChromeCheckpointPort(),
    otp: new OtpBroker(content),
    clock: () => Date.now(),
    emit: (message) => {
      relay.bridge?.emit(message);
      if (message.type === 'state' && schedules) void schedules.observe(message.task);
    },
    provider: () => provider,
    subscriptionText: () => subscriptionText,
    subscriptionTools: () => true,
    capabilities: () => ({ vision }),
    profile: {
      candidateProfile: (signal) => server.candidateProfile(signal),
      searchCv: (query, signal) => server.searchCv(query, signal),
      documentFile: (documentId, signal) => server.documentFile(documentId, signal),
    },
    timeZone: () => userTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    nativeBrowser: (command, originTabId, signal) =>
      executeNativeBrowserCommand(command, originTabId, browser as unknown as BrowserApi, {
        signal,
        getWorkArea: async (window) => {
          const displays = await browser.system.display.getInfo();
          const x = (window.left ?? 0) + (window.width ?? 0) / 2;
          const y = (window.top ?? 0) + (window.height ?? 0) / 2;
          const display =
            displays.find(
              ({ bounds }) =>
                x >= bounds.left &&
                x < bounds.left + bounds.width &&
                y >= bounds.top &&
                y < bounds.top + bounds.height,
            ) ?? displays.find((item) => item.isPrimary);
          if (!display) throw new Error('Could not read the available screen area.');
          return display.workArea;
        },
      }),
  });
  const scheduleKey = 'nudgeDeferredTasksV1';
  const schedules = new DeferredTasks({
    load: async () => (await browser.storage.local.get(scheduleKey))[scheduleKey],
    save: async (jobs) => {
      await browser.storage.local.set({ [scheduleKey]: jobs });
    },
    alarm: async (id, when) => {
      await browser.alarms.create(`nudge-task:${id}`, { when });
    },
    clearAlarm: async (id) => {
      await browser.alarms.clear(`nudge-task:${id}`);
    },
    tabs,
    provider: () => provider,
    subscriptionText: () => subscriptionText,
    selection: () => ({ ...providerSelection }),
    prepare: async (selection) => {
      await loadProvider();
      if (JSON.stringify(selection) !== JSON.stringify(providerSelection))
        throw new Error(
          'Provider settings changed since this task was scheduled. Please schedule it again.',
        );
      await server.setProviderSelection(selection);
    },
    snapshot: () => controller.snapshot(),
    start: (input) => controller.startScheduled(input),
    emit: (message) => relay.bridge?.emit(message),
    clock: () => Date.now(),
  });
  const scheduler = schedules;
  const ready = providerReady.then(() => controller.restore()).then(() => scheduler.restore());
  const bridge = createPanelBridge(controller, {
    ready,
    instruct: (text, origin) => scheduler.instruct(text, origin),
    snapshot: () => scheduler.snapshot(),
    cancel: (id) => scheduler.cancel(id),
    manage: (id, action, changes) => scheduler.manage(id, action, changes),
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith('nudge-task:'))
      void ready.then(() => scheduler.runDue()).catch(() => undefined);
  });
  relay.bridge = bridge;
  cdp.onLost((reason) =>
    bridge.emit({
      type: 'need_capability',
      capability: 'trusted_input',
      reason:
        reason === 'canceled_by_user'
          ? 'You cancelled Nudge’s input control from Chrome’s debugging bar.'
          : 'The tab Nudge was controlling closed.',
    }),
  );
  void ready.then(() => scheduler.runDue()).catch(() => undefined);

  browser.runtime.onConnect.addListener((port) => bridge.connect(port as unknown as PortLike));

  browser.runtime.onMessage.addListener(
    (input: unknown, sender, sendResponse: (response: unknown) => void) => {
      const event = ContentEventSchema.safeParse(input);
      if (event.success) {
        if (sender.tab?.id !== undefined)
          controller.timedEnded(event.data.repeatId, event.data.reason);
        return undefined;
      }
      const parsed = ExtensionMessageSchema.safeParse(input);
      if (!parsed.success) return undefined;
      if (parsed.data.type === 'sidepanel.open') {
        const tabId = sender.tab?.id;
        if (tabId === undefined) {
          sendResponse({ ok: false, error: 'unsupported-page' });
          return undefined;
        }
        browser.sidePanel.open({ tabId }).then(
          () => sendResponse({ ok: true }),
          () => sendResponse({ ok: false, error: 'use-toolbar-button' }),
        );
        return true;
      }
      return undefined;
    },
  );
});
