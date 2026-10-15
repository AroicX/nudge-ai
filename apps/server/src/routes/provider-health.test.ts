import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerProviderHealthRoute } from './provider-health';

describe('provider health route', () => {
  it('returns models and capabilities for a reachable Ollama server', async () => {
    const app = Fastify();
    registerProviderHealthRoute(app, {
      authenticate: async () => undefined,
      discoverOllama: vi.fn().mockResolvedValue(['qwen3:8b']),
    });
    const result = await app.inject({
      method: 'GET',
      url: '/api/providers/health?baseUrl=http%3A%2F%2F127.0.0.1%3A11434',
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      openai: { available: true },
      ollama: { available: true, models: ['qwen3:8b'] },
    });
  });

  it('returns a useful unreachable state instead of failing the route', async () => {
    const app = Fastify();
    registerProviderHealthRoute(app, {
      authenticate: async () => undefined,
      discoverOllama: vi.fn().mockRejectedValue(new Error('unreachable')),
    });
    const result = await app.inject({ method: 'GET', url: '/api/providers/health' });
    expect(result.json()).toMatchObject({ ollama: { available: false, models: [] } });
  });
});
