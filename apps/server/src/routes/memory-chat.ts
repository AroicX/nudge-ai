import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { MemoryIdSchema } from '@nudge/contracts';
import type { MemoryStore } from '../memory/memory-store';
import { referenceContext } from '../memory/reference-context';
import type { MemoryChatResponder } from '../memory/chat';

export function registerMemoryChatRoute(
  app: FastifyInstance,
  options: {
    authenticate: preHandlerHookHandler;
    store: MemoryStore;
    respond: MemoryChatResponder;
  },
) {
  let busy = false;
  const schema = z
    .object({
      chatId: MemoryIdSchema,
      text: z.string().trim().min(1).max(4000),
      provider: z.enum(['ollama', 'openai']),
    })
    .strict();
  app.post('/api/memory/chat', { preHandler: options.authenticate }, async (request, reply) => {
    const input = schema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid chat message.' });
    options.store.getChat(input.data.chatId);
    if (busy)
      return reply
        .code(429)
        .send({ error: 'Nudge is already answering. Stop that reply or wait for it to finish.' });
    busy = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120000);
    const onClose = () => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.on('close', onClose);
    try {
      const messages = options.store.listMessages(input.data.chatId);
      // The UI may have saved this user turn already; do not duplicate it in the prompt.
      if (messages.at(-1)?.text === input.data.text && messages.at(-1)?.role === 'user')
        messages.pop();
      const history = messages
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.text.slice(0, 1500) }));
      const text = await options.respond(
        {
          provider: input.data.provider,
          question: input.data.text,
          context: referenceContext(options.store, input.data.text),
          history,
        },
        abort.signal,
      );
      return { text, sources: options.store.search(input.data.text).slice(0, 5) };
    } catch (error) {
      return reply.code(abort.signal.aborted ? 504 : 502).send({
        error: abort.signal.aborted
          ? 'The reply took too long. Try a shorter question.'
          : error instanceof Error
            ? error.message
            : 'Could not answer this question.',
      });
    } finally {
      busy = false;
      clearTimeout(timer);
      reply.raw.off('close', onClose);
    }
  });
}
