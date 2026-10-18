import { expect, it } from 'vitest';
import { MemoryStore } from './memory-store';

it('disables new automatic facts while preserving manual details and chat history', () => {
  const store = new MemoryStore(':memory:');
  try {
    expect(store.preferences()).toEqual({ autoRemember: true, localDiagnostics: false });
    store.setPreferences({ autoRemember: false, localDiagnostics: true });
    const chat = store.createChat();
    store.upsertMessages(
      chat.id,
      [
        {
          id: 'user-1',
          role: 'user',
          text: 'My name is Ada.',
          createdAt: new Date().toISOString(),
          sources: [],
        },
      ],
      chat.generation,
    );
    expect(store.listFacts()).toEqual([]);
    expect(store.listMessages(chat.id)).toHaveLength(1);
    store.setFact('name', 'Ada');
    expect(store.listFacts()[0]?.value).toBe('Ada');
    expect(store.preferences()).toEqual({ autoRemember: false, localDiagnostics: true });
  } finally {
    store.close();
  }
});
