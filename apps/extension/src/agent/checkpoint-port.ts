import type { Checkpoint } from '@nudge/core';

import type { CheckpointPort } from './ports';

const KEY = 'nudgeTaskCheckpointV1';

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** chrome.storage.session: survives service-worker restarts, cleared when the browser closes. */
export function createCheckpointPort(area: StorageArea): CheckpointPort {
  return {
    async save(checkpoint) {
      await area.set({ [KEY]: checkpoint });
    },
    async load() {
      const value = (await area.get(KEY))[KEY] as Checkpoint | undefined;
      return value && value.version === 1 ? value : undefined;
    },
    async clear() {
      await area.remove(KEY);
    },
  };
}
