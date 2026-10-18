import {
  PlannerRequestSchema,
  PlannerResponseSchema,
  ScopeRequestSchema,
  ScopeResponseSchema,
} from '@nudge/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { z } from 'zod';

import type { PlannerFactory, PlannerProvider } from '../planner/planner-provider';

interface AgentPlanRouteOptions {
  authenticate: preHandlerHookHandler;
  plannerFactory: PlannerFactory;
  timeoutMs: number;
  useProviderTimeout?: boolean;
  planRateLimit: number;
  scopeRateLimit: number;
  referenceContext?: (query: string) => string;
}

function override(request: FastifyRequest): 'openai' | 'ollama' | undefined {
  const header = request.headers['x-nudge-provider'];
  return header === 'openai' || header === 'ollama' ? header : undefined;
}

async function runWithTimeout<T>(
  reply: FastifyReply,
  request: FastifyRequest,
  timeoutMs: number,
  output: z.ZodType<T>,
  work: (signal: AbortSignal) => Promise<unknown>,
) {
  const controller = new AbortController();
  const timeoutError = new Error('Planner request timed out.');
  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  request.raw.on('close', () => {
    if (!reply.sent) controller.abort(new Error('Client went away.'));
  });
  try {
    const result = await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
          once: true,
        }),
      ),
    ]);
    const parsed = output.safeParse(result);
    if (!parsed.success)
      return reply.code(502).send({ error: 'Planner returned an invalid response.' });
    return parsed.data;
  } catch (error) {
    if (controller.signal.reason === timeoutError)
      return reply.code(504).send({ error: timeoutError.message });
    request.log.warn(
      { err: error instanceof Error ? error.message : 'unknown' },
      'Planner request failed',
    );
    const message =
      error instanceof Error && /ollama|tool|vision/i.test(error.message)
        ? error.message
        : 'Planner request failed.';
    return reply.code(502).send({ error: message });
  } finally {
    clearTimeout(timeout);
  }
}

export function registerAgentPlanRoutes(
  app: FastifyInstance,
  options: AgentPlanRouteOptions,
): void {
  app.post(
    '/api/agent/plan',
    {
      preHandler: options.authenticate,
      config: { rateLimit: { max: options.planRateLimit, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const input = PlannerRequestSchema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'Invalid planner request.' });
      const planner: PlannerProvider = options.plannerFactory(override(request));
      return runWithTimeout(
        reply,
        request,
        options.useProviderTimeout
          ? (planner.requestTimeoutMs ?? options.timeoutMs)
          : options.timeoutMs,
        PlannerResponseSchema,
        (signal) =>
          planner.plan(
            {
              ...input.data,
              // Only the paired local store supplies this field; clients cannot inject saved facts.
              referenceContext: options.referenceContext?.(input.data.goal) ?? '',
            currentTime: `${new Date().toISOString()} (local timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
            },
            signal,
          ),
      );
    },
  );

  app.post(
    '/api/agent/scope',
    {
      preHandler: options.authenticate,
      config: { rateLimit: { max: options.scopeRateLimit, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const input = ScopeRequestSchema.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: 'Invalid scope request.' });
      const planner = options.plannerFactory(override(request));
      return runWithTimeout(
        reply,
        request,
        options.useProviderTimeout
          ? (planner.requestTimeoutMs ?? options.timeoutMs)
          : options.timeoutMs,
        ScopeResponseSchema,
        (signal) => planner.scope(input.data, signal),
      );
    },
  );
}
