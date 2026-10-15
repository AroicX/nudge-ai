import { ContentRequestSchema } from '@nudge/contracts';

import { createPageAdapter } from '../src/content/page-adapter';
import { mountLauncher } from '../src/launcher/Launcher';
import { sendExtensionMessage } from '../src/messaging/runtime';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  main() {
    const adapter = createPageAdapter({
      document,
      window,
      documentId: crypto.randomUUID(),
      visualizeActions: true,
      onTimedEnd: (repeatId, reason) => {
        void browser.runtime.sendMessage({ type: 'content.timed_ended', repeatId, reason }).catch(() => undefined);
      },
    });

    browser.runtime.onMessage.addListener((input: unknown) => {
      const request = ContentRequestSchema.safeParse(input);
      return request.success ? adapter.handle(request.data) : undefined;
    });

    mountLauncher({
      onOpen: () => {
        void sendExtensionMessage({
          type: 'sidepanel.open',
          requestId: crypto.randomUUID(),
        });
      },
    });
  },
});
