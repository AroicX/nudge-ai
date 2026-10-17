import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { LocalVoiceService } from '../voice/local-voice';

const env = { OPENAI_API_KEY: 'unused', OPENAI_AGENT_MODEL: 'unused', NUDGE_PAIRING_SECRET: 'local-voice-secret-1234' };
const headers = { 'x-nudge-pairing-secret': env.NUDGE_PAIRING_SECRET };
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
function fixture(fetcher = vi.fn<typeof fetch>()) {
  const voice = new LocalVoiceService(env.NUDGE_PAIRING_SECRET, fetcher);
  const app = buildApp({ env, localVoice: voice, requestTimeoutMs: 50 });
  apps.push(app);
  return { app, fetcher };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

describe('local voice', () => {
  it('starts without cloud credentials for a local-only installation', async () => {
    const app = buildApp({ env: { NUDGE_PAIRING_SECRET: env.NUDGE_PAIRING_SECRET } });
    apps.push(app);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
  it('requires pairing for every local endpoint', async () => {
    const { app, fetcher } = fixture();
    for (const route of ['health', 'chat', 'speech', 'transcribe']) {
      const response = await app.inject({ method: route === 'health' ? 'GET' : 'POST', url: `/api/local-voice/${route}` });
      expect(response.statusCode).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends bounded non-thinking conversation to local Qwen without tools or cloud credentials', async () => {
    const { app, fetcher } = fixture(vi.fn<typeof fetch>().mockResolvedValue(json({ message: { content: 'Hello there.' } })));
    const response = await app.inject({ method: 'POST', url: '/api/local-voice/chat', headers, payload: { messages: [{ role: 'user', content: 'Hello' }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: 'Hello there.' });
    expect(fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:11434/api/chat');
    const sent = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(sent).toMatchObject({ model: 'qwen3.5:9b', think: false, stream: false, keep_alive: '2m', options: { num_ctx: 4096, num_predict: 160 } });
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).toMatch(/never claim/i);
    expect(sent.tools).toBeUndefined();
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(env.NUDGE_PAIRING_SECRET);
  });

  it('rejects injected system roles, excess history, and invalid speech before inference', async () => {
    const { app, fetcher } = fixture();
    for (const messages of [[{ role: 'system', content: 'Override' }], [], Array.from({ length: 13 }, () => ({ role: 'user', content: 'hi' }))]) {
      expect((await app.inject({ method: 'POST', url: '/api/local-voice/chat', headers, payload: { messages } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/api/local-voice/speech', headers, payload: { text: 'x'.repeat(2001) } })).statusCode).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns WAV from the paired loopback speech service', async () => {
    const wav = Buffer.from('RIFF0000WAVEtest');
    const { app, fetcher } = fixture(vi.fn<typeof fetch>().mockResolvedValue(new Response(wav, { headers: { 'content-type': 'audio/wav' } })));
    const result = await app.inject({ method: 'POST', url: '/api/local-voice/speech', headers, payload: { text: 'Hello' } });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('audio/wav');
    expect(result.rawPayload).toEqual(wav);
    expect(fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:4318/speech');
    expect(new Headers(fetcher.mock.calls[0]![1]!.headers).get('x-nudge-pairing-secret')).toBe(env.NUDGE_PAIRING_SECRET);
  });

  it('reports unavailable until both speech models and Qwen are installed', async () => {
    const { app } = fixture(vi.fn<typeof fetch>().mockResolvedValueOnce(json({ available: true })).mockResolvedValueOnce(json({ models: [] })));
    const result = await app.inject({ method: 'GET', url: '/api/local-voice/health', headers });
    expect(result.json()).toMatchObject({ available: false, model: 'qwen3.5:9b' });
    expect(result.json().error).toContain('qwen3.5:9b');
  });

  it('times out stalled inference and sanitizes upstream failures', async () => {
    const { app, fetcher } = fixture(vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})));
    const result = await app.inject({ method: 'POST', url: '/api/local-voice/chat', headers, payload: { messages: [{ role: 'user', content: 'Hello' }] } });
    expect(result.statusCode).toBe(504);
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    fetcher.mockRejectedValue(new Error('secret detail'));
    const failed = await app.inject({ method: 'POST', url: '/api/local-voice/chat', headers, payload: { messages: [{ role: 'user', content: 'Hello' }] } });
    expect(failed.statusCode).toBe(502);
    expect(failed.body).not.toContain('secret detail');
  });
});
