import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'wxt';

function readRootPairingSecret(): string | undefined {
  if (process.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET) {
    return process.env.WXT_PUBLIC_NUDGE_PAIRING_SECRET;
  }
  try {
    return parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'))
      .WXT_PUBLIC_NUDGE_PAIRING_SECRET;
  } catch {
    return undefined;
  }
}

function requirePairingSecret() {
  return {
    name: 'nudge-require-pairing-secret',
    config() {
      if (!readRootPairingSecret()) {
        throw new Error(
          'WXT_PUBLIC_NUDGE_PAIRING_SECRET is required and must match NUDGE_PAIRING_SECRET.',
        );
      }
    },
  };
}

// `debugger` cannot be an optional permission in Chrome. It is used only for trusted
// pointer/keyboard input on the task's own tab, attached on demand and detached afterwards.
const permissions = [
  'activeTab',
  'scripting',
  'sidePanel',
  'alarms',
  'storage',
  'tabs',
  'debugger',
  'system.display',
  'nativeMessaging',
];

// E2E builds (WXT_PUBLIC_NUDGE_E2E=1) expose test hooks in the side panel and go to a separate folder.
const e2e = process.env.WXT_PUBLIC_NUDGE_E2E === '1';

export default defineConfig({
  ...(e2e ? { outDir: '.output-e2e' } : {}),
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    envDir: '../..',
    plugins: [requirePairingSecret(), tailwindcss()],
  }),
  manifest: {
    name: 'Nudge',
    version: '0.1.0',
    description: 'Browser companion that follows your instructions on websites. Public alpha.',
    permissions,
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: {
      16: 'icons/nudge-16.png',
      32: 'icons/nudge-32.png',
      48: 'icons/nudge-48.png',
      128: 'icons/nudge-128.png',
    },
    action: {
      default_title: 'Open Nudge',
      default_icon: {
        16: 'icons/nudge-16.png',
        32: 'icons/nudge-32.png',
        48: 'icons/nudge-48.png',
      },
    },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
