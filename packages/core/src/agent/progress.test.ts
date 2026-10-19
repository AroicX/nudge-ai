import { expect, it } from 'vitest';

import { ProgressMonitor } from './progress';

it('forbids repeating an action that left the same state unchanged and stops when exhausted', () => {
  const monitor = new ProgressMonitor({ sameAction: 2, stalledSteps: 6 });
  const step = { fingerprint: 'click:create', beforeHash: 'a', afterHash: 'a', verified: false };
  expect(monitor.record(step)).toMatchObject({ sameActionNoChange: 1, forbidRepeat: false, exhausted: false });
  expect(monitor.record(step)).toMatchObject({ sameActionNoChange: 2, forbidRepeat: true, exhausted: false });
  expect(monitor.isForbidden('click:create', 'a')).toBe(true);
  expect(monitor.isForbidden('click:create', 'b')).toBe(false);
  expect(monitor.record(step).exhausted).toBe(true);
});

it('resets when the page state changes or an outcome is verified', () => {
  const monitor = new ProgressMonitor();
  monitor.record({ fingerprint: 'x', beforeHash: 'a', afterHash: 'a', verified: false });
  expect(monitor.record({ fingerprint: 'y', beforeHash: 'a', afterHash: 'b', verified: false }).stalledSteps).toBe(0);
  expect(monitor.record({ fingerprint: 'x', beforeHash: 'b', afterHash: 'b', verified: true }).stalledSteps).toBe(0);
});

it('stops after many different actions without any observable change', () => {
  const monitor = new ProgressMonitor({ sameAction: 5, stalledSteps: 3 });
  for (const fingerprint of ['a', 'b']) monitor.record({ fingerprint, beforeHash: 's', afterHash: 's', verified: false });
  expect(monitor.record({ fingerprint: 'c', beforeHash: 's', afterHash: 's', verified: false }).exhausted).toBe(true);
});
