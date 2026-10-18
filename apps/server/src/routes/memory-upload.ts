import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { MemoryStore } from '../memory/memory-store';
import { documentText } from '../memory/document-text';

export function registerMemoryUploadRoute(
  app: FastifyInstance,
  options: {
    authenticate: preHandlerHookHandler;
    store: MemoryStore;
  },
) {
  app.post(
    '/api/memory/documents/upload',
    { preHandler: options.authenticate },
    async (request, reply) => {
      try {
        const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
        if (!file) return reply.code(400).send({ error: 'Choose a document to upload.' });
        const bytes = await file.toBuffer();
        if (file.file.truncated)
          return reply.code(413).send({ error: 'Choose a document smaller than 5 MB.' });
        const filename = file.filename.split(/[\\/]/).at(-1)!.slice(0, 250);
        const text = await documentText(filename, bytes);
        return options.store.addDocument({ filename, text });
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : 'Could not read this document.',
        });
      }
    },
  );
}
