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

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    envDir: '../..',
    plugins: [requirePairingSecret(), tailwindcss()],
  }),
  manifest: {
    name: 'Nudge',
    description: 'A fast, conversational browser assistant that acts with you in control.',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage', 'tabs'],
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
