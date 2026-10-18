import { ProviderSelectionSchema, type ProviderSelection } from '@nudge/contracts';

export interface SharedProviderStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}
export type ProviderLock = <T>(operation: () => Promise<T>) => Promise<T>;
export const sharedProviderKeys = ['providerSelection', 'providerUpdate'];

export async function readSharedProvider(storage: SharedProviderStorage) {
  const saved = await storage.get(sharedProviderKeys);
  const update = saved.providerUpdate as { status?: string; error?: string } | undefined;
  const parsed = ProviderSelectionSchema.safeParse(saved.providerSelection);
  return {
    selection: parsed.success ? parsed.data : undefined,
    pending: update?.status === 'pending',
    error:
      update?.status === 'failed'
        ? (update.error ?? 'Could not update provider settings.')
        : undefined,
  };
}

/** Web Locks serialize writes across extension pages, not just within one React root. */
export async function writeSharedProvider(
  lock: ProviderLock,
  storage: SharedProviderStorage,
  backend: (selection: ProviderSelection) => Promise<void>,
  prepare: () => Promise<{ selection: ProviderSelection; vision: boolean }>,
) {
  return lock(async () => {
    await storage.set({ providerUpdate: { status: 'pending' } });
    try {
      const { selection, vision } = await prepare();
      await backend(selection);
      // Publish the choice only after the server accepted it, in one storage update.
      await storage.set({
        providerSelection: selection,
        providerVision: vision,
        providerUpdate: { status: 'ready' },
      });
      return selection;
    } catch (error) {
      await storage.set({
        providerUpdate: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Could not update provider settings.',
        },
      });
      throw error;
    }
  });
}
