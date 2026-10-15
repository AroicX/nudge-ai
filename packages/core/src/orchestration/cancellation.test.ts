import { describe, expect, it } from 'vitest';

import { CancellationError, CancellationGate } from './cancellation';

describe('CancellationGate', () => {
  it('invalidates a captured generation after stop', () => {
    const gate = new CancellationGate();
    const generation = gate.generation;

    gate.stop();

    expect(() => gate.assertActive(generation)).toThrow(CancellationError);
    expect(gate.generation).toBe(generation + 1);
  });

  it('creates an abort signal that is aborted by stop', () => {
    const gate = new CancellationGate();
    const signal = gate.signal;

    gate.stop();

    expect(signal.aborted).toBe(true);
  });
});
