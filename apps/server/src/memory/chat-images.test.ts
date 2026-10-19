import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    responses = { create };
  },
}));

import { createMemoryChatResponder } from './chat';

const IMAGE = { name: 'shot.png', mime: 'image/png' as const, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
const question = { question: 'What does this error mean?', context: '{}', history: [], images: [IMAGE] };

beforeEach(() => create.mockReset());

describe('chat images', () => {
  it('sends input_image parts to the OpenAI Responses API', async () => {
    create.mockResolvedValue({ output_text: 'It is a 404.' });
    const respond = createMemoryChatResponder(() => ({ selection: { provider: 'openai' }, apiKey: 'sk-test', openAIModel: 'gpt-test' }));
    expect(await respond({ provider: 'openai', ...question }, new AbortController().signal)).toBe('It is a 404.');
    const body = create.mock.calls[0]![0];
    expect(body.input.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'What does this error mean?' },
        { type: 'input_image', image_url: IMAGE.dataUrl, detail: 'auto' },
      ],
    });
  });

  it('sends base64 images to a vision-capable Ollama model', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: 'A 404 page.' } })));
    const respond = createMemoryChatResponder(
      () => ({ selection: { provider: 'ollama', model: 'qwen2.5vl', baseUrl: 'http://127.0.0.1:11434' }, apiKey: '', openAIModel: 'unused' }),
      fetcher,
      async () => ({ vision: true }),
    );
    await respond({ provider: 'ollama', ...question }, new AbortController().signal);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1].body));
    expect(body.messages.at(-1)).toMatchObject({ role: 'user', images: ['iVBORw0KGgo='] });
  });

  it('refuses images for a non-vision local model without falling back to the API', async () => {
    const fetcher = vi.fn();
    const respond = createMemoryChatResponder(
      () => ({ selection: { provider: 'ollama', model: 'qwen3:8b', baseUrl: 'http://127.0.0.1:11434' }, apiKey: 'sk-would-bill', openAIModel: 'gpt-test' }),
      fetcher,
      async () => ({ vision: false }),
    );
    await expect(respond({ provider: 'ollama', ...question }, new AbortController().signal)).rejects.toThrow(/qwen3:8b.*cannot read images/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
