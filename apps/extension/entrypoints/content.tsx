import { contentRandomUUID } from '../src/content/random-id';
import { ContentRequestSchema } from '@nudge/contracts';

import { createPageAdapter } from '../src/content/page-adapter';
import { mountLauncher } from '../src/launcher/Launcher';
import { sendExtensionMessage } from '../src/messaging/runtime';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  main() {
    // Guard against a second instance when the script is injected programmatically after load.
    const marker = window as unknown as { __nudgeContentLoaded?: boolean };
    if (marker.__nudgeContentLoaded) return;
    marker.__nudgeContentLoaded = true;
    const adapter = createPageAdapter({
      document,
      window,
      documentId: contentRandomUUID(),
      visualizeActions: true,
      onTimedEnd: (repeatId, reason) => {
        void browser.runtime.sendMessage({ type: 'content.timed_ended', repeatId, reason }).catch(() => undefined);
      },
    });

    // Respond via sendResponse + `return true`: Chrome does not reliably resolve promise returns here.
    browser.runtime.onMessage.addListener((input: unknown, _sender, sendResponse: (response: unknown) => void) => {
      const request = ContentRequestSchema.safeParse(input);
      if (!request.success) return undefined;
      adapter.handle(request.data).then(sendResponse, (error: unknown) =>
        sendResponse({ ok: false, detail: error instanceof Error ? error.message.slice(0, 500) : 'Content error.', changed: false, documentId: 'unknown' }),
      );
      return true;
    });

    mountLauncher({
      onOpen: () => {
        void sendExtensionMessage({
          type: 'sidepanel.open',
          requestId: contentRandomUUID(),
        });
      },
    });
  },
});
