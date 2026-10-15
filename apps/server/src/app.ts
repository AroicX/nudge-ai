import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import OpenAI from 'openai';

import { pairingGuard } from './auth/pairing';
import { loadConfig } from './config';
import type { DecisionProviderFactory } from './providers/decision-provider';
import { OpenAIDecisionProvider } from './providers/openai-provider';
import { registerAgentStepRoute } from './routes/agent-step';
import {
  OpenAIAudioTranscriber,
  registerAudioTranscribeRoute,
  type AudioTranscriber,
} from './routes/audio-transcribe';
import { registerHealthRoute } from './routes/health';
import { registerProviderSettingsRoutes } from './routes/provider-settings';
import {
  OpenAIRealtimeSessionIssuer,
  registerRealtimeSessionRoute,
  type RealtimeSessionIssuer,
} from './routes/realtime-session';

export interface BuildAppOptions {
  env?: Record<string, string | undefined>;
  providerFactory?: DecisionProviderFactory;
  requestTimeoutMs?: number;
  rateLimitMax?: number;
  bodyLimit?: number;
  logger?: boolean;
  realtimeIssuer?: RealtimeSessionIssuer;
  audioTranscriber?: AudioTranscriber;
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
  const authenticate = pairingGuard(config.pairingSecret);
  const providerFactory =
    options.providerFactory ??
    ((apiKey: string) => new OpenAIDecisionProvider(new OpenAI({ apiKey }), config.agentModel));

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
    });
    registerAgentStepRoute(protectedRoutes, {
      authenticate,
      providerFactory,
      getApiKey: () => sessionKey ?? config.openAIApiKey,
      timeoutMs: options.requestTimeoutMs ?? 20_000,
      rateLimitMax: options.rateLimitMax ?? 30,
    });
    registerRealtimeSessionRoute(protectedRoutes, {
      authenticate,
      issuer: options.realtimeIssuer ?? new OpenAIRealtimeSessionIssuer(),
      getApiKey: () => sessionKey ?? config.openAIApiKey,
      model: config.realtimeModel,
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
