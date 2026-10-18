import { describe, expect, it, vi } from 'vitest';
import { ProviderWriteQueue } from './provider-write-queue';

describe('provider persistence', () => {
  it('finishes old backend writes before the new selection and skips stale saved preferences', async () => {
    const queue = new ProviderWriteQueue();
    let current = 0;
    let release!: () => void;
    const backend: string[] = [];
    const oldStorage = vi.fn(async () => {});
    const newStorage = vi.fn(async () => {});
    const old = queue.write(
      () => current === 0,
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        backend.push('old');
      },
      oldStorage,
    );
    await Promise.resolve();
    current = 1;
    const next = queue.write(
      () => current === 1,
      async () => {
        backend.push('new');
      },
      newStorage,
    );
    expect(backend).toEqual([]);
    release();
    await expect(old).resolves.toBe(false);
    await expect(next).resolves.toBe(true);
    expect(backend).toEqual(['old', 'new']);
    expect(oldStorage).not.toHaveBeenCalled();
    expect(newStorage).toHaveBeenCalledOnce();
  });

  it('does not mark settings ready until backend and storage both complete', async () => {
    const queue = new ProviderWriteQueue();
    let release!: () => void;
    const ready = vi.fn();
    const pending = queue
      .write(
        () => true,
        async () => {},
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .then(ready);
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    release();
    await pending;
    expect(ready).toHaveBeenCalledWith(true);
  });
});
