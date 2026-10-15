import { describe, expect, it, vi } from 'vitest';

import { ProviderFallbackController } from './provider-fallback';

describe('ProviderFallbackController', () => {
  it('approves only the matching live request for one task', async () => {
    const now = vi.fn(() => 1_000);
    const controller = new ProviderFallbackController(now);
    const pending = controller.request('task-1', 'Model lacks tools');
    expect(controller.approveFallback(pending.request.id, 'task-1')).toBe(true);
    await expect(pending.decision).resolves.toBe('approved');
    expect(controller.approveFallback(pending.request.id, 'task-1')).toBe(false);
  });

  it('supports decline and rejects expired or cross-task approvals', async () => {
    let time = 1_000;
    const controller = new ProviderFallbackController(() => time);
    const declined = controller.request('task-1', 'Unavailable');
    controller.declineFallback(declined.request.id, 'task-1');
    await expect(declined.decision).resolves.toBe('declined');

    const expired = controller.request('task-2', 'Unavailable', 50);
    time += 100;
    expect(controller.approveFallback(expired.request.id, 'task-2')).toBe(false);
    expect(controller.approveFallback(expired.request.id, 'task-3')).toBe(false);
    await expect(expired.decision).resolves.toBe('declined');
  });
});
