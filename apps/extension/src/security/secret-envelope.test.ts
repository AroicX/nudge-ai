import { describe, expect, it } from 'vitest';

import { SecretEnvelope } from './secret-envelope';

const binding = { taskId: 'task-1', destinationTabId: 7, destinationDocumentId: 'doc-1', elementId: 'doc-1:1', cancellationGeneration: 2 };

describe('SecretEnvelope', () => {
  it('is one-use, bound, non-serializable, and expires after two minutes', () => {
    let now = 1_000;
    const envelope = SecretEnvelope.create('123456', binding, () => now);
    expect(JSON.stringify(envelope)).not.toContain('123456');
    expect(() => envelope.readOnce({ ...binding, destinationTabId: 8 })).toThrow('destination');
    expect(envelope.readOnce(binding)).toBe('123456');
    expect(() => envelope.readOnce(binding)).toThrow('used');
    const expired = SecretEnvelope.create('654321', binding, () => now);
    now += 120_001;
    expect(() => expired.readOnce(binding)).toThrow('expired');
  });

  it('destroys the secret on cancellation', () => {
    const envelope = SecretEnvelope.create('123456', binding);
    envelope.destroy();
    expect(() => envelope.readOnce(binding)).toThrow('destroyed');
  });
});
