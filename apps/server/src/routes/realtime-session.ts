import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

export interface RealtimeSessionMaterial {
  clientSecret: string;
  expiresAt: number;
  model: string;
}

export interface RealtimeSessionIssuer {
  issue(
    input: { apiKey: string; model: string; voice: string },
    signal: AbortSignal,
  ): Promise<RealtimeSessionMaterial>;
}

class RealtimeSessionError extends Error {
  constructor(
    readonly publicMessage: string,
    message = publicMessage,
  ) {
    super(message);
  }
}

function messageForUpstreamStatus(status: number): string {
  if (status === 401) return 'OpenAI rejected this API key. Add a valid API key in Settings.';
  if (status === 403) return 'Realtime voice is not enabled for this OpenAI project.';
  if (status === 429) return 'OpenAI voice quota is currently unavailable.';
  return 'OpenAI could not start a Realtime voice session.';
}

const RequestSchema = z.object({ voice: z.enum(['marin', 'cedar']).default('marin') }).strict();

export class OpenAIRealtimeSessionIssuer implements RealtimeSessionIssuer {
  async issue(
    input: { apiKey: string; model: string; voice: string },
    signal: AbortSignal,
  ): Promise<RealtimeSessionMaterial> {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: input.model,
          output_modalities: ['audio'],
          audio: {
            input: {
              turn_detection: {
                type: 'server_vad',
                interrupt_response: true,
                create_response: true,
              },
            },
            output: { voice: input.voice },
          },
          instructions:
            'Be concise and conversational. Browser actions are requests only; never claim an action completed until Nudge reports verified evidence.',
        },
      }),
    });
    if (!response.ok) {
      throw new RealtimeSessionError(
        messageForUpstreamStatus(response.status),
        `Realtime session upstream failed (${response.status}).`,
      );
    }
    const body = (await response.json()) as {
      value?: string;
      expires_at?: number;
      client_secret?: { value?: string; expires_at?: number };
    };
    const clientSecret = body.value ?? body.client_secret?.value;
    const expiresAt = body.expires_at ?? body.client_secret?.expires_at;
    if (!clientSecret || !expiresAt) throw new Error('Realtime session response was invalid.');
    return { clientSecret, expiresAt, model: input.model };
  }
}

export function registerRealtimeSessionRoute(
  app: FastifyInstance,
  options: {
    authenticate: preHandlerHookHandler;
    issuer: RealtimeSessionIssuer;
    getApiKey(): string;
    model: string;
    timeoutMs: number;
  },
): void {
  app.post(
    '/api/realtime/session',
    { preHandler: options.authenticate },
    async (request, reply) => {
      const input = RequestSchema.safeParse(request.body ?? {});
      if (!input.success)
        return reply.code(400).send({ error: 'Invalid realtime session request.' });
      const apiKey = options.getApiKey();
      if (!apiKey) return reply.code(503).send({ error: 'OpenAI is not configured.' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        return await options.issuer.issue(
          { apiKey, model: options.model, voice: input.data.voice },
          controller.signal,
        );
      } catch (error) {
        const publicMessage =
          error &&
          typeof error === 'object' &&
          'publicMessage' in error &&
          typeof error.publicMessage === 'string'
            ? error.publicMessage
            : 'Could not start realtime voice.';
        return reply.code(controller.signal.aborted ? 504 : 502).send({
          error: controller.signal.aborted ? 'Realtime session timed out.' : publicMessage,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}
