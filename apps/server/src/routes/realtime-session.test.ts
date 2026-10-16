import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { OpenAIRealtimeSessionIssuer, type RealtimeSessionIssuer } from './realtime-session';

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

  it('returns a useful safe reason when realtime is unavailable for the key', async () => {
    const issuer: RealtimeSessionIssuer = {
      issue: vi.fn().mockRejectedValue(
        Object.assign(new Error('Realtime is not available for this API key.'), {
          publicMessage: 'Realtime is not available for this API key.',
        }),
      ),
    };
    const app = buildApp({ env, realtimeIssuer: issuer });
    const response = await app.inject({
      method: 'POST',
      url: '/api/realtime/session',
      headers: { 'x-nudge-pairing-secret': env.NUDGE_PAIRING_SECRET },
      payload: {},
    });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Realtime is not available for this API key.' });
    await app.close();
  });
});

describe('OpenAIRealtimeSessionIssuer', () => {
  it('creates an interruptible conversational session without browser tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 'ek_test', expires_at: 123 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const issuer = new OpenAIRealtimeSessionIssuer();
    await issuer.issue(
      { apiKey: 'sk-test', model: 'gpt-realtime', voice: 'marin' },
      new AbortController().signal,
    );
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(request.session.voice).toBeUndefined();
    expect(request.session.audio.output.voice).toBe('marin');
    expect(request.session.audio.input).toEqual({
      transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
      noise_reduction: { type: 'near_field' },
      turn_detection: {
        type: 'semantic_vad',
        eagerness: 'low',
        create_response: true,
        interrupt_response: true,
      },
    });
    expect(request.session.tools ?? []).toEqual([]);
    expect(request.session.instructions).toMatch(/never claim/i);
    vi.unstubAllGlobals();
  });

  it('enables user transcription so speech reaches the task controller, and exposes no tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 'ek_test', expires_at: 123 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new OpenAIRealtimeSessionIssuer().issue(
      { apiKey: 'sk-test', model: 'gpt-realtime', voice: 'marin', transcribeModel: 'gpt-4o-mini-transcribe' },
      new AbortController().signal,
    );
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(request.session.audio.input.transcription).toEqual({
      model: 'gpt-4o-mini-transcribe',
      language: 'en',
    });
    expect(request.session.tools ?? []).toEqual([]);
    expect(request.session.instructions).toMatch(/never claim/i);
    vi.unstubAllGlobals();
  });
});
