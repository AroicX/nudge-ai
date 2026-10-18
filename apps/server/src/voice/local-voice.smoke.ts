/** Opt-in local integration check. Never contacts OpenAI or uses the microphone. */
import { config } from 'dotenv';
import { buildApp } from '../app';

config({ path: '../../.env', quiet: true });

async function main() {
  const app = buildApp();
  const headers = { 'x-nudge-pairing-secret': process.env.NUDGE_PAIRING_SECRET ?? '' };
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await work();
    timings[name] = Math.round(performance.now() - start);
    return result;
  };
  try {
    const health = await app.inject({ method: 'GET', url: '/api/local-voice/health', headers });
    if (!health.json().available) throw new Error(health.json().error ?? 'Local voice is not ready.');
    const input = await timed('inputSpeechMs', async () => {
      const result = await app.inject({ method: 'POST', url: '/api/local-voice/speech', headers, payload: { text: 'What is two plus two?' } });
      if (result.statusCode !== 200) throw new Error(result.json().error);
      return result.rawPayload;
    });
    const boundary = 'nudge-local-smoke';
    const transcript = await timed('transcribeMs', async () => {
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
        input, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const result = await app.inject({ method: 'POST', url: '/api/local-voice/transcribe', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
      if (result.statusCode !== 200) throw new Error(result.json().error);
      const text = result.json().text as string;
      if (!/two|2/i.test(text)) throw new Error(`Unexpected synthetic transcript: ${text}`);
      return text;
    });
    const answer = await timed('chatMs', async () => {
      const result = await app.inject({ method: 'POST', url: '/api/local-voice/chat', headers, payload: { messages: [{ role: 'user', content: transcript }] } });
      if (result.statusCode !== 200) throw new Error(result.json().error);
      const text = result.json().text as string;
      if (!/four|4/i.test(text)) throw new Error(`Unexpected answer: ${text}`);
      return text;
    });
    const output = await timed('replySpeechMs', async () => {
      const result = await app.inject({ method: 'POST', url: '/api/local-voice/speech', headers, payload: { text: answer } });
      if (result.statusCode !== 200 || result.rawPayload.toString('ascii', 0, 4) !== 'RIFF') throw new Error('No valid spoken reply.');
      return result.rawPayload.length;
    });
    console.log(JSON.stringify({ transcript, answer, outputAudioBytes: output, timings }, null, 2));
  } finally { await app.close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local voice smoke test failed.');
  process.exitCode = 1;
});
