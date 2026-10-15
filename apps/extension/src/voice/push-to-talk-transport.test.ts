// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { chooseRecorderMime } from './push-to-talk-transport';

describe('push-to-talk transport', () => {
  it('selects the first supported efficient format', () => {
    expect(chooseRecorderMime((mime) => mime === 'audio/webm')).toBe('audio/webm');
  });
  it('allows the browser default when no preferred format exists', () => {
    expect(chooseRecorderMime(() => false)).toBe('');
  });
});
