import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Nudge',
    description: 'A fast, conversational browser assistant that acts with you in control.',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage'],
    host_permissions: ['http://127.0.0.1/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'Open Nudge' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
