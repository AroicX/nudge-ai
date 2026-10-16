import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { OllamaDecisionProvider } from '../providers/ollama-provider';

const QuerySchema = z.object({ baseUrl: z.string().optional() });

export function registerProviderHealthRoute(
  app: FastifyInstance,
  options: {
    authenticate: preHandlerHookHandler;
    discoverOllama?: (baseUrl: string) => Promise<string[]>;
    ollamaCapabilities?: (baseUrl: string, model: string) => Promise<{ tools: boolean; vision: boolean }>;
  },
) {
  app.get('/api/providers/health', { preHandler: options.authenticate }, async (request) => {
    const query = QuerySchema.parse(request.query);
    const baseUrl = query.baseUrl ?? 'http://127.0.0.1:11434';
    try {
      const models = await (options.discoverOllama ?? OllamaDecisionProvider.discover)(baseUrl);
      const inspect = options.ollamaCapabilities ?? ((base: string, model: string) => OllamaDecisionProvider.capabilities(base, model));
      const modelCapabilities = Object.fromEntries(
        await Promise.all(
          models.slice(0, 20).map(async (model) => [
            model,
            await inspect(baseUrl, model).catch(() => ({ tools: false, vision: false })),
          ]),
        ),
      );
      return {
        openai: { available: true, capabilities: { browserTools: true, realtimeVoice: true, dictation: true } },
        ollama: { available: true, models, modelCapabilities, capabilities: { browserTools: true, realtimeVoice: false, dictation: true } },
      };
    } catch (error) {
      return {
        openai: { available: true, capabilities: { browserTools: true, realtimeVoice: true, dictation: true } },
        ollama: { available: false, models: [], error: error instanceof Error ? error.message : 'Ollama unavailable', capabilities: { browserTools: false, realtimeVoice: false, dictation: true } },
      };
    }
  });
}
