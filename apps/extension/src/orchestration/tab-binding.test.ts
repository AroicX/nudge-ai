import { describe, expect, it } from 'vitest';

import { assertBoundTab } from './tab-binding';

describe('assertBoundTab', () => {
  it('rejects execution when the active tab changes mid-task', () => {
    expect(() => assertBoundTab(12, 13)).toThrow('Task is bound to tab 12');
  });
});
