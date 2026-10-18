import { expect, it, vi } from 'vitest';
import type { PlannerRequest, ProviderSelection, ScopeRequest } from '@nudge/contracts';
import { createPlanPlannerPort } from './planner-port';

it('keeps plan errors and cancellation on the companion without paid fallback', async () => {
  const api = { scope: vi.fn(), plan: vi.fn() };
  const companion = { scope: vi.fn().mockRejectedValue(new Error('HTTP 429 plan limit')), plan: vi.fn().mockRejectedValue(new Error('Stopped')) };
  const port = createPlanPlannerPort(api, companion, () => ({ provider: 'chatgpt', accountId: 'a', model: 'm' }));
  const signal = new AbortController().signal;
  await expect(port.scope({} as ScopeRequest, signal)).rejects.toThrow('HTTP 429');
  await expect(port.plan({} as PlannerRequest, signal)).rejects.toThrow('Stopped');
  expect(companion.plan).toHaveBeenCalledWith('a', 'm', {}, signal);
  await expect(port.plan({} as PlannerRequest, signal, 'openai')).rejects.toThrow('bound to your ChatGPT plan');
  expect(api.scope).not.toHaveBeenCalled();
  expect(api.plan).not.toHaveBeenCalled();
});

it('refuses to continue a browser task after switching ChatGPT accounts', async () => {
  let selection: ProviderSelection = { provider: 'chatgpt', accountId: 'a', model: 'm' };
  const companion = { scope: vi.fn().mockResolvedValue({}), plan: vi.fn() };
  const api = { scope: vi.fn(), plan: vi.fn() };
  const port = createPlanPlannerPort(api, companion, () => selection);
  const signal = new AbortController().signal;
  await port.scope({} as ScopeRequest, signal);
  selection = { provider: 'chatgpt', accountId: 'b', model: 'm' };
  await expect(port.plan({} as PlannerRequest, signal)).rejects.toThrow('account or model changed');
  expect(companion.plan).not.toHaveBeenCalled();
  expect(api.plan).not.toHaveBeenCalled();
});
