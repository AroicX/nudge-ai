import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { LocalVoiceService } from '../voice/local-voice';

const ChatSchema = z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) }).strict()).min(1).max(12) }).strict()
  .refine((input) => input.messages.reduce((size, message) => size + message.content.length, 0) <= 10000);
const SpeechSchema = z.object({ text: z.string().trim().min(1).max(2000) }).strict();
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']);

export function registerLocalVoiceRoutes(app: FastifyInstance, options: {
  authenticate: preHandlerHookHandler;
  service: LocalVoiceService;
  timeoutMs: number;
}) {
  const busy = new Set<string>();
  const run = async (kind: string, request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<unknown>) => {
    if (busy.has(kind)) return reply.code(429).send({ error: 'Local voice is busy. Please try again.' });
    busy.add(kind);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs);
    const onClose = () => { if (!reply.raw.writableEnded) controller.abort(new Error('disconnected')); };
    reply.raw.on('close', onClose);
    let onAbort: () => void = () => undefined;
    try {
      return await Promise.race([
        work(controller.signal),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } catch {
      reply.removeHeader('content-type');
      return reply.code(controller.signal.aborted ? 504 : 502).send({ error: controller.signal.aborted ? 'Local voice timed out. Try a shorter message.' : 'Local voice failed. Check Ollama and the local speech service.' });
    } finally {
      clearTimeout(timer);
      reply.raw.off('close', onClose);
      controller.signal.removeEventListener('abort', onAbort);
      busy.delete(kind);
    }
  };
  const protectedRoute = { preHandler: options.authenticate, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  app.get('/api/local-voice/health', protectedRoute, (request, reply) => run('health', request, reply, (signal) => options.service.health(signal)));
  app.post('/api/local-voice/prepare', protectedRoute, (request, reply) => run('chat', request, reply, async (signal) => {
    await options.service.prepare(signal);
    return { ready: true };
  }));
  app.post('/api/local-voice/chat', protectedRoute, async (request, reply) => {
    const input = ChatSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid local conversation.' });
    return run('chat', request, reply, async (signal) => ({ text: await options.service.chat(input.data.messages, signal) }));
  });
  app.post('/api/local-voice/chat-stream', protectedRoute, async (request, reply) => {
    const input = ChatSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid local conversation.' });
    if (busy.has('chat')) return reply.code(429).send({ error: 'Local voice is busy. Please try again.' });
    busy.add('chat');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs);
    let cleaned = false;
    const close = () => { controller.abort(); cleanup(); };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer); busy.delete('chat'); reply.raw.off('close', close);
    };
    reply.raw.on('close', close);
    const messages = input.data.messages;
    async function* stream() {
      try {
        for await (const text of options.service.chatStream(messages, controller.signal)) {
          yield JSON.stringify({ text }) + '\n';
        }
        yield JSON.stringify({ done: true }) + '\n';
      } catch {
        yield JSON.stringify({ error: 'Local voice interrupted or unavailable.' }) + '\n';
      } finally { cleanup(); }
    }
    return reply.type('application/x-ndjson').header('cache-control', 'no-store').send(Readable.from(stream()));
  });
  app.post('/api/local-voice/speech', protectedRoute, async (request, reply) => {
    const input = SpeechSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid speech text.' });
    return run('speech', request, reply, async (signal) => {
      const audio = await options.service.speech(input.data.text, signal);
      reply.type('audio/wav').header('cache-control', 'no-store');
      return audio;
    });
  });
  app.post('/api/local-voice/transcribe', protectedRoute, async (request, reply) => {
    const part = await request.file().catch(() => undefined);
    const mime = part?.mimetype.split(';')[0];
    if (!part || !mime || !AUDIO_TYPES.has(mime)) return reply.code(400).send({ error: 'Unsupported audio upload.' });
    const bytes = await part.toBuffer();
    if (!bytes.length || part.file.truncated) return reply.code(400).send({ error: 'Audio is empty or too large.' });
    return run('transcribe', request, reply, async (signal) => ({ text: await options.service.transcribe(bytes, mime, signal) }));
  });
}
