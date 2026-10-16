import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { ProviderSelection } from '@nudge/contracts';

import { pairingGuard } from './auth/pairing';
import { loadConfig } from './config';
import { registerAgentPlanRoutes } from './routes/agent-plan';
import { OpenAIPlanner } from './planner/openai-planner';
import { OllamaPlanner } from './planner/ollama-planner';
import type { PlannerFactory } from './planner/planner-provider';
import { ScriptedPlanner, type ScenarioFile } from './planner/scripted-planner';
import {
  OpenAIAudioTranscriber,
  registerAudioTranscribeRoute,
  type AudioTranscriber,
} from './routes/audio-transcribe';
import { registerHealthRoute } from './routes/health';
import { registerProviderSettingsRoutes } from './routes/provider-settings';
import { registerProviderHealthRoute } from './routes/provider-health';
import {
  OpenAIRealtimeSessionIssuer,
  registerRealtimeSessionRoute,
  type RealtimeSessionIssuer,
} from './routes/realtime-session';

export interface BuildAppOptions {
  env?: Record<string, string | undefined>;
  requestTimeoutMs?: number;
  rateLimitMax?: number;
  bodyLimit?: number;
  logger?: boolean;
  realtimeIssuer?: RealtimeSessionIssuer;
  audioTranscriber?: AudioTranscriber;
  plannerFactory?: PlannerFactory;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = loadConfig(options.env ?? process.env);
  const app = Fastify({
    logger:
      options.logger === true
        ? {
            redact: ['req.headers.authorization', 'req.headers.x-nudge-pairing-secret', 'req.body'],
          }
        : false,
    bodyLimit: options.bodyLimit ?? 256_000,
  });
  let sessionKey: string | undefined;
  let selection: ProviderSelection = { provider: 'openai' };
  const authenticate = pairingGuard(config.pairingSecret);

  void app.register(cors, {
    origin: (origin, callback) => {
      const allowed =
        origin === undefined ||
        origin.startsWith('chrome-extension://') ||
        /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
      callback(allowed ? null : new Error('Origin not allowed'), allowed);
    },
  });
  registerHealthRoute(app);
  void app.register(async (protectedRoutes) => {
    await protectedRoutes.register(rateLimit, { global: false });
    registerProviderSettingsRoutes(protectedRoutes, {
      authenticate,
      setSessionKey: (value) => {
        sessionKey = value;
      },
      setSelection: (value) => {
        selection = value;
      },
    });
    registerProviderHealthRoute(protectedRoutes, { authenticate });
    const scripted =
      config.planner === 'scripted' && config.plannerScript ? ScriptedPlanner.fromPath(config.plannerScript) : undefined;
    const plannerFactory: PlannerFactory = (providerOverride) => {
      const apiKey = sessionKey ?? config.openAIApiKey;
      if (options.plannerFactory) return options.plannerFactory(providerOverride, { apiKey });
      if (scripted) return scripted;
      const active = providerOverride === 'openai' ? { provider: 'openai' as const } : selection;
      return active.provider === 'openai'
        ? new OpenAIPlanner(new OpenAI({ apiKey }), config.agentModel)
        : new OllamaPlanner(active.baseUrl, active.model);
    };
    registerAgentPlanRoutes(protectedRoutes, {
      authenticate,
      plannerFactory,
      timeoutMs: options.requestTimeoutMs ?? 30_000,
      planRateLimit: options.rateLimitMax ?? (scripted ? 600 : 60),
      scopeRateLimit: scripted ? 600 : 10,
    });
    if (scripted) {
      // Test-only hooks for the Playwright harness; never registered for live planners.
      protectedRoutes.get('/api/test/planner-log', { preHandler: authenticate }, async () => scripted.log);
      protectedRoutes.put('/api/test/scenarios', { preHandler: authenticate }, async (request) => {
        scripted.replace(request.body as ScenarioFile);
        return { ok: true };
      });
    }
    registerRealtimeSessionRoute(protectedRoutes, {
      authenticate,
      issuer: options.realtimeIssuer ?? new OpenAIRealtimeSessionIssuer(),
      getApiKey: () => sessionKey ?? config.openAIApiKey,
      model: config.realtimeModel,
      transcribeModel: config.transcribeModel,
      timeoutMs: options.requestTimeoutMs ?? 20_000,
    });
    await registerAudioTranscribeRoute(protectedRoutes, {
      authenticate,
      transcriber: options.audioTranscriber ?? new OpenAIAudioTranscriber(),
      getApiKey: () => sessionKey ?? config.openAIApiKey,
      model: config.transcribeModel,
      timeoutMs: options.requestTimeoutMs ?? 20_000,
    });
  });

  return app;
}
