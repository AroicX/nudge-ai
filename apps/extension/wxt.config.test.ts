import { describe, expect, it } from 'vitest';

import config from './wxt.config';

describe('extension host permissions', () => {
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
