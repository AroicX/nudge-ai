import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerClient } from './server-client';

afterEach(() => vi.unstubAllGlobals());

describe('local voice requests', () => {
  it('sends local dictation as WAV to the paired local endpoint', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ text: 'Hello' })));
    vi.stubGlobal('fetch', fetch);
    const client = new ServerClient('http://127.0.0.1:4317', 'paired');
    const signal = new AbortController().signal;
    await expect(
      client.transcribe(new Blob(['audio'], { type: 'audio/wav' }), signal, true),
    ).resolves.toBe('Hello');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/local-voice/transcribe',
      expect.objectContaining({ headers: { 'x-nudge-pairing-secret': 'paired' }, signal }),
    );
    const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((request[1].body as FormData).get('audio')).toMatchObject({
      name: 'speech.wav',
      type: 'audio/wav',
    });
  });

  it('retains useful local setup errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Whisper model is missing' }), { status: 503 }),
      ),
    );
    await expect(
      new ServerClient().transcribe(new Blob(['audio']), new AbortController().signal, true),
    ).rejects.toThrow('Whisper model is missing');
  });
});

it('decodes fragmented streamed replies and rejects incomplete streams', async () => {
  const bytes = new TextEncoder().encode('{"text":"Hello, ẹ káàrọ̀. "}\n{"text":"How are you?"}\n{"done":true}\n');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); },
  }))));
  const onText = vi.fn();
  await expect(new ServerClient().localVoiceChatStream([{ role: 'user', content: 'Hi' }], new AbortController().signal, onText)).resolves.toBe('Hello, ẹ káàrọ̀. How are you?');
  expect(onText).toHaveBeenCalledTimes(2);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"text":"partial"}\n')));
  await expect(new ServerClient().localVoiceChatStream([{ role: 'user', content: 'Hi' }], new AbortController().signal, vi.fn())).rejects.toThrow('unexpectedly');
});
