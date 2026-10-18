import type { PlannerRequest, ProviderSelection } from '@nudge/contracts';
import type { PlannerPort } from '../agent/ports';
import type { ChatGptCompanion } from './companion';

/**
 * The OpenAI/Ollama paths receive saved profile context from the server's /api/agent/plan.
 * ChatGPT-plan requests bypass that route, so attach the same context here; a failed
 * retrieval is reported as a failure, never as "no saved information".
 */
export async function withReferenceContext(
  request: PlannerRequest,
  context: ((query: string, signal: AbortSignal) => Promise<string>) | undefined,
  signal: AbortSignal,
): Promise<PlannerRequest> {
  if (!context) return request;
  const query = [request.goal, request.authorization.instruction, ...request.memory.constraints.map((item) => item.text)].join('\n');
  try {
    return { ...request, referenceContext: (await context(query, signal)).slice(0, 8_000) };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      ...request,
      referenceContext: JSON.stringify({
        retrievalError: `Saved profile and documents could not be retrieved (${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}). Tell the user retrieval failed and that the local Nudge server must be running; do not say the information is missing.`,
      }),
    };
  }
}

export function createPlanPlannerPort(
  api: PlannerPort,
  companion: Pick<ChatGptCompanion, 'plan' | 'scope'>,
  selection: () => ProviderSelection,
  context?: (query: string, signal: AbortSignal) => Promise<string>,
): PlannerPort {
  let bound: Extract<ProviderSelection, { provider: 'chatgpt' }> | undefined;
  return {
    async scope(request, signal, override) {
      const current = selection();
      bound = current.provider === 'chatgpt' && override !== 'openai' ? { ...current } : undefined;
      if (bound) return companion.scope(bound.accountId, bound.model, request, signal);
      return api.scope(request, signal, override);
    },
    async plan(request, signal, override) {
      const current = selection();
      if (bound && override) throw new Error('This browser task is bound to your ChatGPT plan. Start a new task to change providers.');
      if (override === 'openai') return api.plan(request, signal, override);
      if (bound || current.provider === 'chatgpt') {
        if (current.provider !== 'chatgpt' || (bound && (bound.accountId !== current.accountId || bound.model !== current.model)))
          throw new Error('ChatGPT account or model changed. Start a new browser task.');
        bound ??= { ...current };
        return companion.plan(bound.accountId, bound.model, await withReferenceContext(request, context, signal), signal);
      }
      return api.plan(request, signal, override);
    },
  };
}
