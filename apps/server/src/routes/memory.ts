import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { MemoryIdSchema, MemoryMessagesSchema } from '@nudge/contracts';
import { MemoryError, type MemoryStore } from '../memory/memory-store';
import { MEMORY_REFERENCE_RULES, referenceContext } from '../memory/reference-context';

const chatInput = z
  .object({ id: MemoryIdSchema.optional(), title: z.string().trim().min(1).max(200).optional() })
  .strict();
const factInput = z
  .object({ value: z.string().trim().min(1).max(2000), source: z.string().max(500).optional() })
  .strict();
const documentInput = z
  .object({
    id: MemoryIdSchema.optional(),
    filename: z.string().trim().min(1).max(250),
    text: z.string().trim().min(1).max(500_000),
  })
  .strict();
function run(reply: FastifyReply, work: () => unknown) {
  try {
    return work();
  } catch (error) {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: 'Invalid memory request.' });
    if (error instanceof MemoryError)
      return reply.code(error.statusCode).send({ error: error.message });
    throw error;
  }
}
export function registerMemoryRoutes(
  app: FastifyInstance,
  options: { authenticate: preHandlerHookHandler; store: MemoryStore },
): void {
  const settings = { preHandler: options.authenticate };
  const store = options.store;
  app.get('/api/memory/preferences', settings, async () => store.preferences());
  app.put('/api/memory/preferences', settings, async (request, reply) =>
    run(reply, () =>
      store.setPreferences(
        z
          .object({ autoRemember: z.boolean(), localDiagnostics: z.boolean() })
          .strict()
          .parse(request.body),
      ),
    ),
  );
  app.get('/api/memory/status', settings, async () => ({ local: true, path: store.path }));
  app.get('/api/memory/chats', settings, async () => ({ chats: store.listChats() }));
  app.post('/api/memory/chats', settings, async (request, reply) =>
    run(reply, () => ({ chat: store.createChat(chatInput.parse(request.body ?? {})) })),
  );
  app.get<{ Params: { id: string } }>('/api/memory/chats/:id', settings, async (request, reply) =>
    run(reply, () => ({ chat: store.getChat(request.params.id) })),
  );
  app.patch<{ Params: { id: string } }>('/api/memory/chats/:id', settings, async (request, reply) =>
    run(reply, () => {
      const { title } = z
        .object({ title: z.string().trim().min(1).max(200) })
        .strict()
        .parse(request.body);
      return { chat: store.renameChat(request.params.id, title) };
    }),
  );
  app.delete<{ Params: { id: string } }>('/api/memory/chats/:id', settings, async (request) => {
    store.deleteChat(request.params.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>(
    '/api/memory/chats/:id/messages',
    settings,
    async (request, reply) =>
      run(reply, () => ({
        messages: store.listMessages(request.params.id),
        generation: store.getChat(request.params.id).generation,
      })),
  );
  app.put<{ Params: { id: string } }>(
    '/api/memory/chats/:id/messages',
    { ...settings, bodyLimit: 4 * 1024 * 1024 },
    async (request, reply) =>
      run(reply, () => {
        const { messages, generation } = MemoryMessagesSchema.parse(request.body);
        return {
          messages: store.upsertMessages(request.params.id, messages, generation),
          generation: store.getChat(request.params.id).generation,
        };
      }),
  );
  app.delete<{ Params: { id: string } }>(
    '/api/memory/chats/:id/messages',
    settings,
    async (request, reply) =>
      run(reply, () => ({ ok: true, generation: store.clearChat(request.params.id).generation })),
  );
  app.get('/api/memory/facts', settings, async () => ({ facts: store.listFacts() }));
  app.put<{ Params: { key: string } }>('/api/memory/facts/:key', settings, async (request, reply) =>
    run(reply, () => {
      const body = factInput.parse(request.body);
      return { fact: store.setFact(request.params.key, body.value, body.source) };
    }),
  );
  app.delete<{ Params: { key: string } }>('/api/memory/facts/:key', settings, async (request) => {
    store.deleteFact(request.params.key);
    return { ok: true };
  });
  app.get('/api/memory/documents', settings, async () => ({ documents: store.listDocuments() }));
  app.post(
    '/api/memory/documents',
    { ...settings, bodyLimit: 2 * 1024 * 1024 },
    async (request, reply) =>
      run(reply, () => ({ document: store.addDocument(documentInput.parse(request.body)) })),
  );
  app.delete<{ Params: { id: string } }>('/api/memory/documents/:id', settings, async (request) => {
    store.deleteDocument(request.params.id);
    return { ok: true };
  });
  app.get('/api/memory/search', settings, async (request, reply) =>
    run(reply, () => {
      const { q, limit } = z
        .object({
          q: z.string().min(1).max(1000),
          limit: z.coerce.number().int().min(1).max(30).default(12),
        })
        .parse(request.query);
      return { results: store.search(q, limit) };
    }),
  );
  app.post('/api/memory/context', settings, async (request, reply) => {
    const input = z.object({ text: z.string().trim().min(1).max(4000) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid context request.' });
    return {
      instructions: `You are Nudge, the user's personal browser companion. Answer conversational questions, review or draft text using the supplied local references. This channel cannot execute browser actions. Never claim that you opened, applied, submitted, sent, or scheduled anything. If the request requires browser action, explain what information is needed without inventing a result. ${MEMORY_REFERENCE_RULES} Say when a requested memory is absent. Keep replies concise but include the actual answer. Relevant saved reference data follows as JSON:\n${referenceContext(store, input.data.text)}`,
    };
  });
}
