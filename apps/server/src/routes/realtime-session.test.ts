import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import type { RealtimeSessionIssuer } from './realtime-session';

const env = {
  OPENAI_API_KEY: 'sk-server-secret',
  OPENAI_AGENT_MODEL: 'gpt-5-mini',
  OPENAI_REALTIME_MODEL: 'gpt-realtime',
  NUDGE_PAIRING_SECRET: 'pairing-secret-1234',
};

describe('POST /api/realtime/session', () => {
  it('requires pairing and never exposes the server key', async () => {
    const issue = vi
      .fn()
      .mockResolvedValue({ clientSecret: 'ek_short', expiresAt: 123456, model: 'gpt-realtime' });
    const app = buildApp({ env, realtimeIssuer: { issue } });
    const denied = await app.inject({ method: 'POST', url: '/api/realtime/session', payload: {} });
    expect(denied.statusCode).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: '/api/realtime/session',
      headers: { 'x-nudge-pairing-secret': env.NUDGE_PAIRING_SECRET },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(env.OPENAI_API_KEY);
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-realtime', voice: 'marin' }),
      expect.any(AbortSignal),
    );
    await app.close();
  });

  it('sanitizes upstream failures', async () => {
    const issuer: RealtimeSessionIssuer = {
      issue: vi.fn().mockRejectedValue(new Error('upstream leaked sk-secret')),
    };
    const app = buildApp({ env, realtimeIssuer: issuer });
    const response = await app.inject({
      method: 'POST',
      url: '/api/realtime/session',
      headers: { 'x-nudge-pairing-secret': env.NUDGE_PAIRING_SECRET },
      payload: { voice: 'cedar' },
    });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('sk-secret');
    await app.close();
  });
});
