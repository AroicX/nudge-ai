import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app';
import type { PlannerProvider } from './planner/planner-provider';
import { plannerRequest } from './planner/test-fixtures';

const request = plannerRequest();
const response = { requestId: 'req_1', toolCall: { tool: 'list_tabs' } };

const secret = 'pairing-secret-with-32-characters';
const auth = { 'x-nudge-pairing-secret': secret };
const providers: Array<Partial<PlannerProvider>> = [];

function appWithProvider(
  provider: Partial<PlannerProvider> = { plan: vi.fn().mockResolvedValue(response) },
  overrides: Record<string, string | undefined> = {},
) {
  return buildApp({
    env: {
      OPENAI_API_KEY: 'env-key',
      OPENAI_AGENT_MODEL: 'configured-model',
      NUDGE_PAIRING_SECRET: secret,
      ...overrides,
    },
    plannerFactory: () => {
      providers.push(provider);
      return provider as PlannerProvider;
    },
    requestTimeoutMs: 30,
    rateLimitMax: 2,
    bodyLimit: 6_000,
  });
}

afterEach(() => {
  providers.splice(0);
});

describe('server boundaries', () => {
  it('serves health without pairing credentials', async () => {
    const app = appWithProvider();
    const result = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ status: 'ok' });
  });

  it.each([undefined, 'wrong-secret'])('rejects a %s pairing secret', async (pairingSecret) => {
    const app = appWithProvider();
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: pairingSecret ? { 'x-nudge-pairing-secret': pairingSecret } : {},
      payload: request,
    });
    await app.close();

    expect(result.statusCode).toBe(401);
  });

  it('rejects payloads over the configured limit', async () => {
    const app = appWithProvider();
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: auth,
      payload: { ...request, goal: 'x'.repeat(7_000) },
    });
    await app.close();

    expect(result.statusCode).toBe(413);
  });

  it('rate limits paired agent requests', async () => {
    const app = appWithProvider();
    await app.inject({ method: 'POST', url: '/api/agent/plan', headers: auth, payload: request });
    await app.inject({ method: 'POST', url: '/api/agent/plan', headers: auth, payload: request });
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: auth,
      payload: request,
    });
    await app.close();

    expect(result.statusCode).toBe(429);
  });

  it('rejects malformed agent input before calling the provider', async () => {
    const plan = vi.fn();
    const app = appWithProvider({ plan });
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: auth,
      payload: { requestId: 'req_bad' },
    });
    await app.close();

    expect(result.statusCode).toBe(400);
    expect(plan).not.toHaveBeenCalled();
  });

  it('times out a provider that does not return', async () => {
    const app = appWithProvider({ plan: () => new Promise(() => undefined) });
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: auth,
      payload: request,
    });
    await app.close();

    expect(result.statusCode).toBe(504);
    expect(result.json()).toEqual({ error: 'Planner request timed out.' });
  });
});

describe('session provider key', () => {
  it('overrides the environment key without returning the key', async () => {
    const seenKeys: string[] = [];
    const app = buildApp({
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_AGENT_MODEL: 'configured-model',
        NUDGE_PAIRING_SECRET: secret,
      },
      plannerFactory: (_override, context) => {
        seenKeys.push(context?.apiKey ?? '');
        return { plan: vi.fn().mockResolvedValue(response) } as unknown as PlannerProvider;
      },
    });

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: auth,
      payload: { apiKey: 'session-key' },
    });
    const step = await app.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: auth,
      payload: request,
    });
    await app.close();

    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('session-key');
    expect(step.statusCode).toBe(200);
    expect(seenKeys.at(-1)).toBe('session-key');
  });

  it('clears a session key when a new app instance starts', async () => {
    const first = appWithProvider();
    await first.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: auth,
      payload: { apiKey: 'session-key' },
    });
    await first.close();

    const seenKeys: string[] = [];
    const second = buildApp({
      env: {
        OPENAI_API_KEY: 'env-key',
        OPENAI_AGENT_MODEL: 'configured-model',
        NUDGE_PAIRING_SECRET: secret,
      },
      plannerFactory: (_override, context) => {
        seenKeys.push(context?.apiKey ?? '');
        return { plan: vi.fn().mockResolvedValue(response) } as unknown as PlannerProvider;
      },
    });
    await second.inject({
      method: 'POST',
      url: '/api/agent/plan',
      headers: auth,
      payload: request,
    });
    await second.close();

    expect(seenKeys.at(-1)).toBe('env-key');
  });
});
