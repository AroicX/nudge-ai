import { describe, expect, it, vi } from 'vitest';
import { openContinuationPanel } from './continuation-panel';

describe('continuation panel', () => {
  it('opens synchronously at window scope so newly opened tabs share it', () => {
    const open = vi.fn().mockResolvedValue(undefined);
    openContinuationPanel(true, 12, open, vi.fn());
    expect(open).toHaveBeenCalledWith({ windowId: 12 });
  });
  it('does not reopen a side panel or guess an unknown window', () => {
    const open = vi.fn();
    openContinuationPanel(false, 12, open, vi.fn());
    openContinuationPanel(true, undefined, open, vi.fn());
    expect(open).not.toHaveBeenCalled();
  });
  it('offers the manual fallback if Chrome denies the gesture', async () => {
    const failed = vi.fn();
    openContinuationPanel(true, 12, vi.fn().mockRejectedValue(new Error('gesture')), failed);
    await Promise.resolve();
    expect(failed).toHaveBeenCalledOnce();
  });
});
