import { describe, expect, it, vi } from 'vitest';

import { ProviderRouter } from './provider-router';

describe('ProviderRouter', () => {
  it('routes OpenAI and loopback Ollama selections', () => {
    const openai = vi.fn(() => ({ step: vi.fn() }));
    const ollama = vi.fn(() => ({ step: vi.fn() }));
    const router = new ProviderRouter(openai, ollama);
    router.create({ provider: 'openai' });
    router.create({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3' });
    expect(openai).toHaveBeenCalledOnce();
    expect(ollama).toHaveBeenCalledWith('http://127.0.0.1:11434', 'qwen3');
  });

  it('rejects non-loopback Ollama URLs', () => {
    const router = new ProviderRouter(vi.fn(), vi.fn());
    expect(() =>
      router.create({ provider: 'ollama', baseUrl: 'http://example.com:11434', model: 'qwen3' } as never),
    ).toThrow('loopback');
  });
});
