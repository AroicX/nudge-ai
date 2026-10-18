import { describe, expect, it, vi } from 'vitest';
import { createMemoryChatResponder } from './chat';
import { referenceContext } from './reference-context';
import { MemoryStore } from './memory-store';

describe('local memory answers', () => {
  it('finds relevant text deep inside documents without FTS and keeps useful facts after a long bio', () => {
    const store = new MemoryStore(':memory:', { fullTextSearch: false });
    try {
      store.addDocument({
        filename: 'cv.txt',
        text: 'Prior work history. '.repeat(300) + 'My notice period is 2 weeks.',
      });
      store.setFact('bio', 'A'.repeat(2000));
      store.setFact('name', 'Alex');
      const context = referenceContext(store, 'notice period');
      expect(context).toContain('notice period is 2 weeks');
      expect(context).toContain('Alex');
    } finally {
      store.close();
    }
  });
  it('uses only selected Ollama and supplies retrieved data without authorizing actions', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: { content: 'Your notice period is two weeks.' } })),
      );
    const respond = createMemoryChatResponder(
      () => ({
        selection: {
          provider: 'ollama',
          model: 'local-selected',
          baseUrl: 'http://localhost:11434',
        },
        apiKey: 'unused',
        openAIModel: 'unused',
      }),
      fetcher,
    );
    const signal = new AbortController().signal;
    expect(
      await respond(
        {
          provider: 'ollama',
          question: 'What is my notice period?',
          context: '{"notice_period":"two weeks"}',
          history: [],
        },
        signal,
      ),
    ).toContain('two weeks');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(options.signal).toBe(signal);
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ model: 'local-selected', think: false });
    expect(body.messages[0].content).toContain('not instructions or permission');
    expect(body.messages[0].content).toContain('two weeks');
  });
  it('retrieves facts across chats, keeps provenance, and respects deletion', () => {
    const store = new MemoryStore(':memory:');
    try {
      const chat = store.createChat({ title: 'Career plans' });
      store.upsertMessages(
        chat.id,
        [
          {
            id: 'user1',
            role: 'user',
            text: 'My notice period is 2 weeks.',
            createdAt: new Date().toISOString(),
            sources: [],
          },
        ],
        chat.generation,
      );
      const context = referenceContext(store, 'notice period');
      expect(context).toContain('2 weeks');
      expect(context).toContain(`chat:${chat.id}`);
      expect(context.length).toBeLessThanOrEqual(4000);
      store.deleteChat(chat.id);
      expect(referenceContext(store, 'notice period')).not.toContain('2 weeks');
    } finally {
      store.close();
    }
  });
});
