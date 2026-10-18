import { describe, expect, it, vi } from 'vitest';
import { readSharedProvider, writeSharedProvider, type ProviderLock } from './shared-provider';
import type { ProviderSelection } from '@nudge/contracts';

function harness() {
  const data: Record<string, unknown> = { providerSelection: { provider: 'openai' } };
  const snapshots: Record<string, unknown>[] = [];
  const storage = {
    get: async () => ({ ...data }),
    set: async (values: Record<string, unknown>) => {
      Object.assign(data, values);
      snapshots.push(structuredClone(data));
    },
  };
  let tail: Promise<unknown> = Promise.resolve();
  const lock: ProviderLock = (operation) => {
    const next = tail.then(operation);
    tail = next.catch(() => undefined);
    return next;
  };
  return { data, storage, lock, snapshots };
}
const local: ProviderSelection = {
  provider: 'ollama',
  model: 'discovered-model',
  baseUrl: 'http://localhost:11434',
};
describe('shared provider coordination', () => {
  it('keeps every surface gated until backend and storage agree', async () => {
    const { storage, lock, data } = harness();
    let finish!: () => void;
    const backend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const operation = writeSharedProvider(lock, storage, backend, async () => ({
      selection: local,
      vision: false,
    }));
    await vi.waitFor(() => expect(backend).toHaveBeenCalled());
    expect(await readSharedProvider(storage)).toMatchObject({
      pending: true,
      selection: { provider: 'openai' },
    });
    finish();
    await operation;
    expect(data.providerSelection).toEqual(local);
    expect(await readSharedProvider(storage)).toEqual({
      pending: false,
      error: undefined,
      selection: local,
    });
  });
  it('serializes two panels and rereads hydration inside the shared lock', async () => {
    const { storage, lock, data } = harness();
    const backend = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      writeSharedProvider(lock, storage, backend, async () => ({
        selection: local,
        vision: false,
      })),
      writeSharedProvider(lock, storage, backend, async () => ({
        selection: (await readSharedProvider(storage)).selection!,
        vision: false,
      })),
    ]);
    expect(backend.mock.calls.map(([selection]) => selection)).toEqual([local, local]);
    expect(data.providerSelection).toEqual(local);
  });
  it('publishes a shared failure without falsely saving the rejected model', async () => {
    const { storage, lock } = harness();
    await expect(
      writeSharedProvider(
        lock,
        storage,
        async () => {
          throw new Error('Server unavailable');
        },
        async () => ({ selection: local, vision: false }),
      ),
    ).rejects.toThrow('Server unavailable');
    expect(await readSharedProvider(storage)).toEqual({
      pending: false,
      error: 'Server unavailable',
      selection: { provider: 'openai' },
    });
  });
});
