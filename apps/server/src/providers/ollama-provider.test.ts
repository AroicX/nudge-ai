import { describe, expect, it, vi } from 'vitest';

import { OllamaDecisionProvider } from './ollama-provider';

function json(value: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => value } as Response);
}

describe('OllamaDecisionProvider', () => {
  it('discovers models and reports the empty state', async () => {
    const fetcher = vi.fn().mockReturnValueOnce(json({ models: [{ name: 'qwen3:8b' }] }));
    await expect(OllamaDecisionProvider.discover('http://127.0.0.1:11434', fetcher)).resolves.toEqual([
      'qwen3:8b',
    ]);
    fetcher.mockReturnValueOnce(json({ models: [] }));
    await expect(OllamaDecisionProvider.discover('http://127.0.0.1:11434', fetcher)).resolves.toEqual([]);
  });

  it('reports an unreachable local server', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(OllamaDecisionProvider.discover('http://localhost:11434', fetcher)).rejects.toThrow(
      'unreachable',
    );
  });

  it('reads tool and vision capabilities from /api/show', async () => {
    const fetcher = vi.fn().mockReturnValueOnce(json({ capabilities: ['completion', 'tools', 'vision'] }));
    await expect(OllamaDecisionProvider.capabilities('http://127.0.0.1:11434', 'llava', fetcher)).resolves.toEqual({ tools: true, vision: true });
  });

  it('refuses non-loopback Ollama URLs', async () => {
    await expect(OllamaDecisionProvider.discover('http://192.168.1.4:11434', vi.fn())).rejects.toThrow(/loopback/);
  });
});
