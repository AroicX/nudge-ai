import { ExtensionMessageSchema } from '@nudge/contracts';

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  browser.runtime.onMessage.addListener((input: unknown, sender) => {
    const parsed = ExtensionMessageSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve({ ok: false, error: 'invalid-message' });
    }

    if (parsed.data.type === 'sidepanel.open') {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        return Promise.resolve({ ok: false, error: 'unsupported-page' });
      }
      return browser.sidePanel.open({ tabId }).then(
        () => ({ ok: true }),
        () => ({ ok: false, error: 'use-toolbar-button' }),
      );
    }

    return undefined;
  });
});
