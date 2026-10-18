import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { ProviderSelection } from '@nudge/contracts';
import { MemoryStore } from './memory/memory-store';
import { referenceContext } from './memory/reference-context';
import { isRoutineFormInstruction } from './planner/routine-form';
import { createMemoryChatResponder } from './memory/chat';
import { registerMemoryRoutes } from './routes/memory';
import { registerMemoryChatRoute } from './routes/memory-chat';
import { registerMemoryUploadRoute } from './routes/memory-upload';

import { pairingGuard } from './auth/pairing';
import { loadConfig } from './config';
import { LocalVoiceService } from './voice/local-voice';
import { registerLocalVoiceRoutes } from './routes/local-voice';
import { registerAgentPlanRoutes } from './routes/agent-plan';
import { OpenAIPlanner } from './planner/openai-planner';
import { OllamaPlanner } from './planner/ollama-planner';
import { resolveBrowserProvider, type PlannerFactory } from './planner/planner-provider';
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
  localVoice?: LocalVoiceService;
  memoryStore?: MemoryStore;
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
  let localSelection: Extract<ProviderSelection, { provider: 'ollama' }> | undefined;
  const authenticate = pairingGuard(config.pairingSecret);
  const memory =
    options.memoryStore ??
    new MemoryStore(
      process.env.NODE_ENV === 'test' || config.planner === 'scripted' ? ':memory:' : undefined,
    );
  if (!options.memoryStore) app.addHook('onClose', async () => memory.close());

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
        if (value.provider === 'ollama') localSelection = value;
      },
    });
    registerProviderHealthRoute(protectedRoutes, { authenticate });
    registerMemoryRoutes(protectedRoutes, { authenticate, store: memory });
    registerMemoryChatRoute(protectedRoutes, {
      authenticate,
      store: memory,
      respond: createMemoryChatResponder((provider) => {
        if (provider === 'ollama' && !localSelection)
          throw new Error('Ollama settings are not ready. Select your local model again.');
        return {
          selection: provider === 'ollama' ? localSelection! : { provider: 'openai' },
          apiKey: sessionKey ?? config.openAIApiKey,
          openAIModel: config.agentModel,
        };
      }),
    });
    const scripted =
      config.planner === 'scripted' && config.plannerScript
        ? ScriptedPlanner.fromPath(config.plannerScript)
        : undefined;
    let cachedLocal: { key: string; planner: OllamaPlanner; expiresAt: number } | undefined;
    const plannerFactory: PlannerFactory = (providerOverride) => {
      const apiKey = sessionKey ?? config.openAIApiKey;
      if (options.plannerFactory) return options.plannerFactory(providerOverride, { apiKey });
      if (scripted) return scripted;
      const active = resolveBrowserProvider(selection, providerOverride, localSelection);
      if (active.provider === 'openai')
        return new OpenAIPlanner(new OpenAI({ apiKey }), config.agentModel);
      const key = JSON.stringify([active.baseUrl, active.model]);
      if (!cachedLocal || cachedLocal.key !== key || cachedLocal.expiresAt < Date.now()) {
        cachedLocal = {
          key,
          expiresAt: Date.now() + 300_000,
          planner: new OllamaPlanner(active.baseUrl, active.model, fetch, (timing) => {
            if (memory.preferences().localDiagnostics)
              app.log.info({ localInference: timing }, 'Local browser decision timing');
          }),
        };
      }
      return cachedLocal.planner;
    };
    registerAgentPlanRoutes(protectedRoutes, {
      authenticate,
      plannerFactory,
      timeoutMs: options.requestTimeoutMs ?? 30_000,
      useProviderTimeout: options.requestTimeoutMs === undefined,
      planRateLimit: options.rateLimitMax ?? (scripted ? 600 : 60),
      scopeRateLimit: scripted ? 600 : 10,
      referenceContext: (query) =>
        referenceContext(memory, query, {
          includeChatHistory:
            !isRoutineFormInstruction(query) ||
            /\b(?:remember|recall|previous|earlier|last|discussed|conversation|chat)\b/i.test(
              query,
            ),
        }),
    });
    if (scripted) {
      // Test-only hooks for the Playwright harness; never registered for live planners.
      protectedRoutes.get(
        '/api/test/planner-log',
        { preHandler: authenticate },
        async () => scripted.log,
      );
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
    registerMemoryUploadRoute(protectedRoutes, { authenticate, store: memory });
    registerLocalVoiceRoutes(protectedRoutes, {
      authenticate,
      service:
        options.localVoice ??
        new LocalVoiceService(config.pairingSecret, fetch, (query) =>
          referenceContext(memory, query),
        ),
      timeoutMs: options.requestTimeoutMs ?? 90_000,
    });
  });

  return app;
}
