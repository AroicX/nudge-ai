import { describe, expect, it } from 'vitest';

import { bindConfirmation, isConfirmationValid, targetFingerprint } from './preview';

const preview = {
  previewId: 'p1', operation: 'Move', location: 'Inbox', criteria: 'invoice', count: 2,
  samples: ['a', 'b'], reversible: true, permanent: false, targetFingerprint: targetFingerprint(['b', 'a']),
};

describe('preview binding', () => {
  it('fingerprints are order-independent and change with the set', () => {
    expect(targetFingerprint(['a', 'b'])).toBe(targetFingerprint(['b', 'a']));
    expect(targetFingerprint(['a', 'b'])).not.toBe(targetFingerprint(['a', 'b', 'c']));
  });

  it('confirmation is void when the fingerprint changes', () => {
    const confirmation = bindConfirmation(preview, 3);
    expect(isConfirmationValid(confirmation, targetFingerprint(['a', 'b']), 3)).toBe(true);
    expect(isConfirmationValid(confirmation, targetFingerprint(['a', 'b', 'c']), 3)).toBe(false);
  });

  it('confirmation is void after a generation bump', () => {
    const confirmation = bindConfirmation(preview, 3);
    expect(isConfirmationValid(confirmation, preview.targetFingerprint, 4)).toBe(false);
  });
});
