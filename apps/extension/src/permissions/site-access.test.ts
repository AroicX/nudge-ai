// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { hasSiteAccess, requestSiteAccess } from './site-access';

describe('site access', () => {
  it('reports unsupported pages without calling Chrome', async () => {
    const contains = vi.fn();

    await expect(hasSiteAccess('chrome://settings', { contains, request: vi.fn() })).resolves.toBe(
      false,
    );
    expect(contains).not.toHaveBeenCalled();
  });

  it('returns a denied result when the user declines access', async () => {
    const request = vi.fn().mockResolvedValue(false);

    await expect(
      requestSiteAccess('https://shop.example/products', { contains: vi.fn(), request }),
    ).resolves.toEqual({ granted: false, originPattern: 'https://shop.example/*' });
    expect(request).toHaveBeenCalledWith({ origins: ['https://shop.example/*'] });
  });
});
