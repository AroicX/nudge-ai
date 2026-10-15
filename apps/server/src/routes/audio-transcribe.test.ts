import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';

const env = {
  OPENAI_API_KEY: 'sk-server',
  OPENAI_AGENT_MODEL: 'gpt-5-mini',
  OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
  NUDGE_PAIRING_SECRET: 'pairing-secret-1234',
};

function multipart(contentType: string, filename: string, value: string) {
  const boundary = 'nudge-test-boundary';
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n${value}\r\n--${boundary}--\r\n`,
  );
  return { payload, header: `multipart/form-data; boundary=${boundary}` };
}

describe('POST /api/audio/transcribe', () => {
  it('accepts bounded audio and returns only text', async () => {
    const transcribe = vi.fn().mockResolvedValue('hello');
    const app = buildApp({ env, audioTranscriber: { transcribe } });
    const form = multipart('audio/webm', 'voice.webm', 'voice');
    const response = await app.inject({
      method: 'POST',
      url: '/api/audio/transcribe',
      headers: {
        'content-type': form.header,
        'x-nudge-pairing-secret': env.NUDGE_PAIRING_SECRET,
      },
      payload: form.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: 'hello' });
    await app.close();
  });

  it('rejects unsupported MIME types', async () => {
    const app = buildApp({ env, audioTranscriber: { transcribe: vi.fn() } });
    const form = multipart('text/plain', 'bad.txt', 'bad');
    const response = await app.inject({
      method: 'POST',
      url: '/api/audio/transcribe',
      headers: {
        'content-type': form.header,
        'x-nudge-pairing-secret': env.NUDGE_PAIRING_SECRET,
      },
      payload: form.payload,
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
