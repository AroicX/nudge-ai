import { describe, expect, it } from 'vitest';

import { isFrameFresh } from './screenshot';

const frame = {
  screenshotId: 's', tabId: 1, documentId: 'd', url: 'https://x.test/a', capturedAt: 1_000,
  viewport: { cssWidth: 1000, cssHeight: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
  imageWidth: 2000, imageHeight: 1600, coordinateSpace: 'css_viewport' as const, mutationCounterAtCapture: 10,
};
const current = { tabId: 1, documentId: 'd', url: 'https://x.test/a', scrollX: 0, scrollY: 0, cssWidth: 1000, cssHeight: 800, mutationCounter: 12 };

describe('isFrameFresh', () => {
  it('is fresh within the mutation tolerance', () => {
    expect(isFrameFresh(frame, current, 2_000)).toEqual({ fresh: true });
  });
  it('is stale after scroll', () => {
    expect(isFrameFresh(frame, { ...current, scrollY: 5 }, 2_000).fresh).toBe(false);
  });
  it('is stale after url change (SPA route)', () => {
    expect(isFrameFresh(frame, { ...current, url: 'https://x.test/b' }, 2_000).fresh).toBe(false);
  });
  it('is stale after 30 seconds', () => {
    expect(isFrameFresh(frame, current, 31_001).fresh).toBe(false);
  });
  it('is stale after many mutations or a resize', () => {
    expect(isFrameFresh(frame, { ...current, mutationCounter: 16 }, 2_000).fresh).toBe(false);
    expect(isFrameFresh(frame, { ...current, cssWidth: 900 }, 2_000).fresh).toBe(false);
  });
});
