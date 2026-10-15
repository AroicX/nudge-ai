import { AgentStepRequestSchema, AgentStepResponseSchema } from '@nudge/contracts';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';

import type { DecisionProviderFactory } from '../providers/decision-provider';

interface AgentStepRouteOptions {
  authenticate: preHandlerHookHandler;
  providerFactory: DecisionProviderFactory;
  getApiKey(): string;
  timeoutMs: number;
  rateLimitMax: number;
}

export function registerAgentStepRoute(app: FastifyInstance, options: AgentStepRouteOptions): void {
  app.post(
    '/api/agent/step',
    {
      preHandler: options.authenticate,
      config: { rateLimit: { max: options.rateLimitMax, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const input = AgentStepRequestSchema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'Invalid agent step request.' });

      const controller = new AbortController();
      const timeoutError = new Error('Provider request timed out.');
      const timeout = setTimeout(() => controller.abort(timeoutError), options.timeoutMs);
      const provider = options.providerFactory(options.getApiKey());
      try {
        const result = await Promise.race([
          provider.step(input.data, controller.signal),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
              once: true,
            });
          }),
        ]);
        const output = AgentStepResponseSchema.safeParse(result);
        if (!output.success)
          return reply.code(502).send({ error: 'Provider returned an invalid response.' });
        return output.data;
      } catch (error) {
        if (error === timeoutError || controller.signal.reason === timeoutError) {
          return reply.code(504).send({ error: timeoutError.message });
        }
        request.log.warn({ err: error }, 'Provider request failed');
        return reply.code(502).send({ error: 'Provider request failed.' });
      } finally {
        clearTimeout(timeout);
        await provider.close?.();
      }
    },
  );
}
