import { ContentRequestSchema, ExtensionMessageSchema } from '@nudge/contracts';

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
      if (request.success) return adapter.handle(request.data);
      const parsed = ExtensionMessageSchema.safeParse(input);
      if (!parsed.success) return undefined;
      if (parsed.data.type === 'page.observe') return adapter.observe();
      if (parsed.data.type === 'page.execute') {
        return adapter.execute(parsed.data.action, {
          active: true,
          documentId: parsed.data.documentId,
        });
      }
      return undefined;
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
