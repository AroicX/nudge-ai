import type { AgentStepRequest, AgentStepResponse } from '@nudge/contracts';
import { describe, expect, it, vi } from 'vitest';

import { OllamaDecisionProvider } from './ollama-provider';

const request = { requestId: 'req-1' } as AgentStepRequest;
const response = {
  requestId: 'req-1',
  task: {
    id: 'task-1', goal: 'Test', intent: 'navigate', constraints: [], successConditions: ['Page read'],
    missingRequiredInformation: [], risk: 'low', status: 'active', cancellationGeneration: 0,
    verifiedActions: [], boundTabId: 1, boundDocumentId: 'doc-1',
  },
  decision: { type: 'act', taskId: 'task-1', action: { type: 'read_page' }, expectedOutcome: 'Read' },
} satisfies AgentStepResponse;

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

  it('validates tool capability and structured decisions', async () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(json({ capabilities: ['completion', 'tools'] }))
      .mockReturnValueOnce(json({ message: { content: JSON.stringify(response) } }));
    const provider = new OllamaDecisionProvider('http://127.0.0.1:11434', 'qwen3:8b', fetcher);
    await expect(provider.step(request, new AbortController().signal)).resolves.toEqual(response);
  });

  it.each([
    [{ message: { content: '{bad' } }, 'malformed JSON'],
    [{ message: { content: '{}' } }, 'invalid Nudge decision'],
  ])('rejects invalid output', async (chat, message) => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(json({ capabilities: ['tools'] }))
      .mockReturnValueOnce(json(chat));
    await expect(
      new OllamaDecisionProvider('http://localhost:11434', 'model', fetcher).step(
        request,
        new AbortController().signal,
      ),
    ).rejects.toThrow(message);
  });

  it('rejects models without tool support and forwards cancellation', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn().mockReturnValueOnce(json({ capabilities: ['completion'] }));
    await expect(
      new OllamaDecisionProvider('http://localhost:11434', 'model', fetcher).step(request, signal),
    ).rejects.toThrow('tool');
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal }));
  });
});
