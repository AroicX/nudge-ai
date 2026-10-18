import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { MemoryError, type MemoryStore } from '../memory/memory-store';
import { candidateProfileFor, searchCv } from '../memory/profile-service';

/** Candidate-profile access for the browser agent. Local, paired-only, no logging of values. */
export function registerProfileRoutes(
  app: FastifyInstance,
  options: {
    authenticate: preHandlerHookHandler;
    store: MemoryStore;
    referenceContext: (query: string) => string;
  },
): void {
  const settings = { preHandler: options.authenticate };
  const failed = (error: unknown) => ({
    error: `Saved profile could not be read: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}.`,
    category: 'retrieval_failed',
  });
  app.get('/api/profile/candidate', settings, async (_request, reply) => {
    try {
      return { profile: candidateProfileFor(options.store) };
    } catch (error) {
      return reply.code(500).send(failed(error));
    }
  });
  app.post('/api/profile/search', settings, async (request, reply) => {
    const input = z.object({ query: z.string().trim().min(1).max(300) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid search.' });
    try {
      return { results: searchCv(options.store, input.data.query) };
    } catch (error) {
      return reply.code(500).send(failed(error));
    }
  });
  app.get('/api/memory/documents/status', settings, async () => {
    const profile = candidateProfileFor(options.store);
    return {
      documents: profile.documents.map(({ id, isDefault, attachable, looksLikeCv, parseStatus }) => ({
        id,
        isDefault,
        attachable,
        looksLikeCv,
        parseStatus,
      })),
      selectedDocumentId: profile.selectedDocumentId ?? null,
      selection: profile.selection,
    };
  });
  app.put<{ Params: { id: string } }>('/api/memory/documents/:id/default', settings, async (request, reply) => {
    const input = z.object({ isDefault: z.boolean() }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid request.' });
    try {
      options.store.setDefaultDocument(input.data.isDefault ? request.params.id : null);
      return { profile: candidateProfileFor(options.store) };
    } catch (error) {
      if (error instanceof MemoryError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
  app.get<{ Params: { id: string } }>('/api/memory/documents/:id/file', settings, async (request, reply) => {
    const file = options.store.documentFile(request.params.id);
    if (!file)
      return reply.code(404).send({
        error: 'The original file is not stored for this document. Re-upload it in Account → Documents to attach it.',
        category: 'missing_information',
      });
    return { filename: file.filename, mime: file.mime, base64: file.bytes.toString('base64') };
  });
  // Lets providers that run outside this server (ChatGPT plan) receive the same saved context.
  app.post('/api/agent/context', settings, async (request, reply) => {
    const input = z.object({ query: z.string().max(8_000) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid context request.' });
    return { referenceContext: options.referenceContext(input.data.query) };
  });
}
