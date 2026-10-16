import { describe, expect, it } from 'vitest';

import config from './wxt.config';

describe('extension host permissions', () => {
  it('registers the complete Nudge icon set', () => {
    expect(config.manifest).toMatchObject({
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
    });
  });

  it('requires access to every HTTP and HTTPS site', () => {
    expect(config.manifest).toMatchObject({
      host_permissions: ['http://*/*', 'https://*/*'],
    });
    expect(config.manifest).not.toHaveProperty('optional_host_permissions');
    expect(config.manifest).toMatchObject({
      permissions: expect.arrayContaining(['tabs']),
    });
  });

  it('loads the repository environment and validates the pairing secret', async () => {
    const viteConfig = await config.vite?.({ mode: 'production' } as never);

    expect(viteConfig?.envDir).toBe('../..');
    expect(viteConfig?.plugins).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'nudge-require-pairing-secret' })]),
    );
  });
});
