import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { MemoryStore } from '../memory/memory-store';

const secret = 'local-memory-test-pairing-secret';
const stores: MemoryStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));
describe('memory conversation provider isolation', () => {
  it('never uses the default cloud provider for a local request after restart', async () => {
    const memoryStore = new MemoryStore(':memory:');
    stores.push(memoryStore);
    const chat = memoryStore.createChat();
    const app = buildApp({
      env: { NUDGE_PAIRING_SECRET: secret, OPENAI_API_KEY: 'must-not-be-used' },
      memoryStore,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/chat',
        headers: { 'x-nudge-pairing-secret': secret },
        payload: { chatId: chat.id, text: 'What is my name?', provider: 'ollama' },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().error).toContain('Ollama settings are not ready');
      const unspecified = await app.inject({
        method: 'POST',
        url: '/api/memory/chat',
        headers: { 'x-nudge-pairing-secret': secret },
        payload: { chatId: chat.id, text: 'What is my name?' },
      });
      expect(unspecified.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
