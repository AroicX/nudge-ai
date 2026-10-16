import { ContentEventSchema, ExtensionMessageSchema } from '@nudge/contracts';

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
import { TaskController } from '../src/agent/task-controller';

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const server = new ServerClient(
    import.meta.env.WXT_PUBLIC_NUDGE_SERVER_URL ?? 'http://127.0.0.1:4317',
    import.meta.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET ?? '',
  );
  let provider: 'openai' | 'ollama' = 'openai';
  let vision = true;
  const loadProvider = async () => {
    const stored = await browser.storage.local.get(['providerSelection', 'providerVision']);
    const selection = stored.providerSelection as { provider?: string } | undefined;
    provider = selection?.provider === 'ollama' ? 'ollama' : 'openai';
    vision = provider === 'openai' ? true : stored.providerVision === true;
  };
  void loadProvider();
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') void loadProvider();
  });

  const tabs = createChromeTabsPort();
  const content = createChromeContentPort();
  const cdp = createCdpExecutor(browser.debugger as never, browser.permissions as never);
  const relay: { bridge?: ReturnType<typeof createPanelBridge> } = {};
  const controller = new TaskController({
    tabs,
    content,
    planner: createChromePlannerPort(server),
    screenshots: createChromeScreenshotPort(tabs, content, cdp),
    cdp,
    checkpoints: createChromeCheckpointPort(),
    otp: new OtpBroker(content),
    clock: () => Date.now(),
    emit: (message) => relay.bridge?.emit(message),
    provider: () => provider,
    capabilities: () => ({ vision }),
  });
  const bridge = createPanelBridge(controller);
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
  void controller.restore();

  browser.runtime.onConnect.addListener((port) => bridge.connect(port as unknown as PortLike));

  browser.runtime.onMessage.addListener((input: unknown, sender, sendResponse: (response: unknown) => void) => {
    const event = ContentEventSchema.safeParse(input);
    if (event.success) {
      if (sender.tab?.id !== undefined) controller.timedEnded(event.data.repeatId, event.data.reason);
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
  });
});
