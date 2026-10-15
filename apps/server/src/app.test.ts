import type { AgentStepRequest, AgentStepResponse } from '@nudge/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app';
import type { DecisionProvider } from './providers/decision-provider';

const request: AgentStepRequest = {
  requestId: 'req_1',
  taskId: 'task_1',
  cancellationGeneration: 0,
  utterance: 'Find an iPhone 16',
  conversation: [],
  page: {
    snapshotId: 'snap_1',
    documentId: 'doc_1',
    capturedAt: '2026-10-15T18:00:00.000Z',
    url: 'https://shop.example.test/',
    title: 'Shop',
    viewport: { width: 1200, height: 800, scrollX: 0, scrollY: 0, pageHeight: 1200 },
    elements: [],
    text: ['Shop'],
    truncated: false,
    inaccessible: [],
  },
  task: null,
};

const response: AgentStepResponse = {
  requestId: 'req_1',
  task: {
    id: 'task_1',
    goal: 'Find an iPhone 16',
    intent: 'search',
    constraints: [{ key: 'model', value: 'iPhone 16', source: 'explicit' }],
    successConditions: ['Matching products are visible'],
    missingRequiredInformation: [],
    risk: 'low',
    status: 'active',
    cancellationGeneration: 0,
    verifiedActions: [],
    boundTabId: 0,
    boundDocumentId: 'doc_1',
  },
  decision: {
    type: 'act',
    taskId: 'task_1',
    action: { type: 'read_page' },
    expectedOutcome: 'Page read',
  },
};

const secret = 'pairing-secret-with-32-characters';
const auth = { 'x-nudge-pairing-secret': secret };
const providers: DecisionProvider[] = [];

function appWithProvider(
  provider: DecisionProvider = { step: vi.fn().mockResolvedValue(response) },
  overrides: Record<string, string | undefined> = {},
) {
  return buildApp({
    env: {
      OPENAI_API_KEY: 'env-key',
      OPENAI_AGENT_MODEL: 'configured-model',
      NUDGE_PAIRING_SECRET: secret,
      ...overrides,
    },
    providerFactory: (apiKey) => {
      providers.push({ ...provider, apiKeyUsedForTest: apiKey } as DecisionProvider);
      return provider;
    },
    requestTimeoutMs: 30,
    rateLimitMax: 2,
    bodyLimit: 2_000,
  });
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map(async (provider) => provider.close?.()));
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
      url: '/api/agent/step',
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
      url: '/api/agent/step',
      headers: auth,
      payload: { ...request, utterance: 'x'.repeat(3_000) },
    });
    await app.close();

    expect(result.statusCode).toBe(413);
  });

  it('rate limits paired agent requests', async () => {
    const app = appWithProvider();
    await app.inject({ method: 'POST', url: '/api/agent/step', headers: auth, payload: request });
    await app.inject({ method: 'POST', url: '/api/agent/step', headers: auth, payload: request });
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/step',
      headers: auth,
      payload: request,
    });
    await app.close();

    expect(result.statusCode).toBe(429);
  });

  it('rejects malformed agent input before calling the provider', async () => {
    const step = vi.fn();
    const app = appWithProvider({ step });
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/step',
      headers: auth,
      payload: { requestId: 'req_bad' },
    });
    await app.close();

    expect(result.statusCode).toBe(400);
    expect(step).not.toHaveBeenCalled();
  });

  it('times out a provider that does not return', async () => {
    const app = appWithProvider({ step: () => new Promise(() => undefined) });
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/step',
      headers: auth,
      payload: request,
    });
    await app.close();

    expect(result.statusCode).toBe(504);
    expect(result.json()).toEqual({ error: 'Provider request timed out.' });
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
      providerFactory: (apiKey) => {
        seenKeys.push(apiKey);
        return { step: vi.fn().mockResolvedValue(response) };
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
      url: '/api/agent/step',
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
      providerFactory: (apiKey) => {
        seenKeys.push(apiKey);
        return { step: vi.fn().mockResolvedValue(response) };
      },
    });
    await second.inject({
      method: 'POST',
      url: '/api/agent/step',
      headers: auth,
      payload: request,
    });
    await second.close();

    expect(seenKeys.at(-1)).toBe('env-key');
  });
});
