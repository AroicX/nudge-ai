import type { ProviderSelection } from '@nudge/contracts';
import type { PlannerPort } from '../agent/ports';
import type { ChatGptCompanion } from './companion';

export function createPlanPlannerPort(api: PlannerPort, companion: Pick<ChatGptCompanion, 'plan' | 'scope'>, selection: () => ProviderSelection): PlannerPort {
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
        return companion.plan(bound.accountId, bound.model, request, signal);
      }
      return api.plan(request, signal, override);
    },
  };
}
