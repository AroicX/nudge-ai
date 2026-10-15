import multipart from '@fastify/multipart';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import OpenAI, { toFile } from 'openai';

export interface AudioTranscriber {
  transcribe(
    input: { bytes: Buffer; filename: string; mimeType: string; apiKey: string; model: string },
    signal: AbortSignal,
  ): Promise<string>;
}

export class OpenAIAudioTranscriber implements AudioTranscriber {
  async transcribe(
    input: { bytes: Buffer; filename: string; mimeType: string; apiKey: string; model: string },
    signal: AbortSignal,
  ): Promise<string> {
    const client = new OpenAI({ apiKey: input.apiKey });
    const file = await toFile(input.bytes, input.filename, { type: input.mimeType });
    const result = await client.audio.transcriptions.create(
      { file, model: input.model },
      { signal },
    );
    return result.text;
  }
}

const ALLOWED_MIME = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']);

export async function registerAudioTranscribeRoute(
  app: FastifyInstance,
  options: {
    authenticate: preHandlerHookHandler;
    transcriber: AudioTranscriber;
    getApiKey(): string;
    model: string;
    timeoutMs: number;
  },
): Promise<void> {
  await app.register(multipart, { limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 0 } });
  app.post(
    '/api/audio/transcribe',
    { preHandler: options.authenticate },
    async (request, reply) => {
      const part = await request.file().catch(() => undefined);
      const mimeType = part?.mimetype?.split(';')[0];
      if (!part || !mimeType || !ALLOWED_MIME.has(mimeType))
        return reply.code(400).send({ error: 'Unsupported audio upload.' });
      const bytes = await part.toBuffer();
      if (!bytes.length) return reply.code(400).send({ error: 'Audio upload was empty.' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const text = await options.transcriber.transcribe(
          {
            bytes,
            filename: part.filename || 'speech.webm',
            mimeType,
            apiKey: options.getApiKey(),
            model: options.model,
          },
          controller.signal,
        );
        return { text: text.trim() };
      } catch {
        return reply
          .code(controller.signal.aborted ? 504 : 502)
          .send({
            error: controller.signal.aborted
              ? 'Transcription timed out.'
              : 'Could not transcribe audio.',
          });
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}
