import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { OllamaDecisionProvider } from '../providers/ollama-provider';
import type { PlannerProvider } from '../planner/planner-provider';
import { plannerRequest } from '../planner/test-fixtures';

const secret = 'pairing-secret-with-32-characters';
const auth = { 'x-nudge-pairing-secret': secret };
const env = { OPENAI_API_KEY: 'sk-test', OPENAI_AGENT_MODEL: 'gpt-test', NUDGE_PAIRING_SECRET: secret };

function app(planner: Partial<PlannerProvider>, extraEnv: Record<string, string> = {}) {
  return buildApp({ env: { ...env, ...extraEnv }, plannerFactory: () => planner as PlannerProvider });
}

afterEach(() => vi.restoreAllMocks());

describe('POST /api/agent/plan', () => {
  it('requires pairing', async () => {
    const response = await app({}).inject({ method: 'POST', url: '/api/agent/plan', payload: plannerRequest() });
    expect(response.statusCode).toBe(401);
  });

  it('returns a validated step', async () => {
    const planner = { plan: vi.fn().mockResolvedValue({ requestId: 'req_1', toolCall: { tool: 'list_tabs' } }) };
    const response = await app(planner).inject({ method: 'POST', url: '/api/agent/plan', headers: auth, payload: plannerRequest() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requestId: 'req_1', toolCall: { tool: 'list_tabs' } });
  });

  it('returns 502 when the provider output is invalid', async () => {
    const planner = { plan: vi.fn().mockResolvedValue({ requestId: 'req_1', toolCall: { tool: 'eval' } }) };
    const response = await app(planner).inject({ method: 'POST', url: '/api/agent/plan', headers: auth, payload: plannerRequest() });
    expect(response.statusCode).toBe(502);
  });

  it('rejects malformed requests', async () => {
    const response = await app({}).inject({ method: 'POST', url: '/api/agent/plan', headers: auth, payload: { goal: 'x' } });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/agent/scope', () => {
  it('validates and returns a proposal', async () => {
    const planner = {
      scope: vi.fn().mockResolvedValue({
        requestId: 's1', goal: 'Collect jobs',
        proposal: { origins: 'browse_web', categories: ['read'], destinations: [], exclusions: [], limits: {} },
      }),
    };
    const response = await app(planner).inject({
      method: 'POST', url: '/api/agent/scope', headers: auth,
      payload: { requestId: 's1', instruction: 'Find jobs', tabs: [] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().goal).toBe('Collect jobs');
    expect(planner.scope.mock.calls[0]![0]).not.toHaveProperty('observation');
  });
});

describe('scripted planner mode', () => {
  it('is refused in production', () => {
    expect(() =>
      buildApp({ env: { ...env, NUDGE_PLANNER: 'scripted', NUDGE_PLANNER_SCRIPT: '/tmp/none.json', NODE_ENV: 'production' } }),
    ).toThrow(/scripted planner/i);
  });
});

describe('GET /api/providers/health', () => {
  it('reports ollama per-model vision capability', async () => {
    vi.spyOn(OllamaDecisionProvider, 'discover').mockResolvedValue(['llava', 'qwen3:8b']);
    vi.spyOn(OllamaDecisionProvider, 'capabilities').mockImplementation(async (_base, model) =>
      model === 'llava' ? { tools: true, vision: true } : { tools: true, vision: false },
    );
    const response = await buildApp({ env }).inject({ method: 'GET', url: '/api/providers/health', headers: auth });
    expect(response.json().ollama.modelCapabilities).toEqual({
      llava: { tools: true, vision: true },
      'qwen3:8b': { tools: true, vision: false },
    });
  });
});
