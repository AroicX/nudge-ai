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

const planRequest = (): PlannerRequest =>
  ({
    goal: 'Apply to this job',
    authorization: { instruction: 'Apply to this job using my CV' },
    memory: { constraints: [{ text: 'Use my London address', instructionVersion: 1 }] },
  }) as unknown as PlannerRequest;

it('gives ChatGPT-plan steps the same saved profile context the API path gets', async () => {
  const companion = { scope: vi.fn(), plan: vi.fn().mockResolvedValue({ toolCall: { tool: 'finish' } }) };
  const context = vi.fn().mockResolvedValue('{"candidateProfile":{"fields":{"email":"ada@example.com"}}}');
  const port = createPlanPlannerPort({ scope: vi.fn(), plan: vi.fn() }, companion, () => ({ provider: 'chatgpt', accountId: 'a', model: 'm' }), context);
  await port.plan(planRequest(), new AbortController().signal);
  expect(context.mock.calls[0]?.[0]).toBe('Apply to this job\nApply to this job using my CV\nUse my London address');
  expect(companion.plan.mock.calls[0]?.[2].referenceContext).toContain('ada@example.com');
});

it('marks a context retrieval failure instead of sending an empty context', async () => {
  const companion = { scope: vi.fn(), plan: vi.fn().mockResolvedValue({}) };
  const port = createPlanPlannerPort({ scope: vi.fn(), plan: vi.fn() }, companion, () => ({ provider: 'chatgpt', accountId: 'a', model: 'm' }), vi.fn().mockRejectedValue(new Error('Failed to fetch')));
  await port.plan(planRequest(), new AbortController().signal);
  const sent = JSON.parse(companion.plan.mock.calls[0]?.[2].referenceContext);
  expect(sent.retrievalError).toMatch(/could not be retrieved \(Failed to fetch\).*do not say the information is missing/);
});
