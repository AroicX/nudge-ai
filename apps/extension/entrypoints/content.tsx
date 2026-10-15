import { mountLauncher } from '../src/launcher/Launcher';
import { sendExtensionMessage } from '../src/messaging/runtime';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  main() {
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
