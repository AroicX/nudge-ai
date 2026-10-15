import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { ProviderSelectionSchema, type ProviderSelection } from '@nudge/contracts';

interface ProviderSettingsOptions {
  authenticate: preHandlerHookHandler;
  setSessionKey(value: string | undefined): void;
  setSelection?(value: ProviderSelection): void;
}

const SessionKeySchema = z.object({ apiKey: z.string().min(8).max(512) }).strict();

export function registerProviderSettingsRoutes(
  app: FastifyInstance,
  options: ProviderSettingsOptions,
): void {
  app.put(
    '/api/settings/provider-key',
    { preHandler: options.authenticate },
    async (request, reply) => {
      const input = SessionKeySchema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'Invalid provider key.' });
      options.setSessionKey(input.data.apiKey);
      return { configured: true, source: 'session' };
    },
  );

  app.delete('/api/settings/provider-key', { preHandler: options.authenticate }, async () => {
    options.setSessionKey(undefined);
    return { configured: true, source: 'environment' };
  });

  app.put('/api/settings/provider', { preHandler: options.authenticate }, async (request, reply) => {
    const input = ProviderSelectionSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Invalid provider selection.' });
    options.setSelection?.(input.data);
    return { configured: true, provider: input.data.provider };
  });
}
