/** Opt-in real local latency check; synthetic input, no microphone or cloud. */
import { config } from 'dotenv';
import { LocalVoiceService } from './local-voice';
import { SpokenPhrases } from '../../../extension/src/voice/local-voice';
config({ path: '../../.env', quiet: true });
const service = new LocalVoiceService(process.env.NUDGE_PAIRING_SECRET ?? '');
const signal = AbortSignal.timeout(120000);
const start = performance.now();
await service.prepare(signal);
console.log(`Preparation: ${Math.round(performance.now() - start)} ms`);
const audio = await service.speech('What is two plus two?', signal);
const began = performance.now();
const text = await service.transcribe(audio, 'audio/wav', signal);
const transcriptionMs = Math.round(performance.now() - began);
const phrases = new SpokenPhrases();
let answer = '', firstAudio: Promise<void> | undefined, firstAudioMs = 0;
const speakFirst = (phrase: string) => {
  firstAudio ??= service.speech(phrase, signal).then((wav) => {
    if (!wav.length) throw new Error('Missing speech');
    firstAudioMs = Math.round(performance.now() - began);
  });
  // Observe a rejection immediately, even if generation has not finished.
  void firstAudio.catch(() => undefined);
};
for await (const chunk of service.chatStream([{ role: 'user', content: text }], signal)) {
  answer += chunk;
  phrases.push(chunk).forEach(speakFirst);
}
phrases.push('', true).forEach(speakFirst);
await firstAudio;
if (!/four|4/i.test(answer)) throw new Error(`Unexpected answer: ${answer}`);
console.log(JSON.stringify({ text, answer, transcriptionMs, firstAudioMs, includesEndOfSpeechDetection: false }, null, 2));
