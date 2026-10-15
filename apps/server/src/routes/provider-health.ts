import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { OllamaDecisionProvider } from '../providers/ollama-provider';

const QuerySchema = z.object({ baseUrl: z.string().optional() });

export function registerProviderHealthRoute(
  app: FastifyInstance,
  options: {
    authenticate: preHandlerHookHandler;
    discoverOllama?: (baseUrl: string) => Promise<string[]>;
  },
) {
  app.get('/api/providers/health', { preHandler: options.authenticate }, async (request) => {
    const query = QuerySchema.parse(request.query);
    const baseUrl = query.baseUrl ?? 'http://127.0.0.1:11434';
    try {
      const models = await (options.discoverOllama ?? OllamaDecisionProvider.discover)(baseUrl);
      return {
        openai: { available: true, capabilities: { browserTools: true, realtimeVoice: true, dictation: true } },
        ollama: { available: true, models, capabilities: { browserTools: true, realtimeVoice: false, dictation: true } },
      };
    } catch (error) {
      return {
        openai: { available: true, capabilities: { browserTools: true, realtimeVoice: true, dictation: true } },
        ollama: { available: false, models: [], error: error instanceof Error ? error.message : 'Ollama unavailable', capabilities: { browserTools: false, realtimeVoice: false, dictation: true } },
      };
    }
  });
}
