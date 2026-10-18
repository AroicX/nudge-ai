import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import type * as VoiceModule from '../../apps/extension/src/voice/local-voice';

declare global {
  interface Window {
    localVoiceModule: typeof VoiceModule;
    voiceTest: {
      voice: VoiceModule.LocalVoiceConversation;
      events: unknown[];
      calls: string[];
      tracks(): MediaStreamTrackState[] | undefined;
    };
  }
}

test('local call captures automatic speech and releases the microphone on end', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'nudge-voice-browser-'));
  const path = join(folder, 'microphone.wav');
  const rate = 48000;
  const samples = rate * 6;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = rate; i < rate * 2; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / rate) * 16000), 44 + i * 2);
  writeFileSync(path, wav);
  const browser = await chromium.launch({
    ...(process.env.NUDGE_CHROMIUM_PATH ? { executablePath: process.env.NUDGE_CHROMIUM_PATH } : { channel: 'chrome' }),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path}%noloop`, '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173');
    const source = readFileSync('apps/extension/src/voice/local-voice.ts', 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    await page.addScriptTag({ content: `window.localVoiceModule = {}; (function(exports) { ${compiled} })(window.localVoiceModule);` });
    await page.evaluate((audioBase64) => {
      const state = window;
      const events: unknown[] = [];
      const calls: string[] = [];
      let stream: MediaStream | undefined;
      const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => { stream = await getMedia(constraints); return stream; };
      const { LocalVoiceConversation, browserLocalAudio } = state.localVoiceModule;
      const audio = new Blob([Uint8Array.from(atob(audioBase64), (x) => x.charCodeAt(0))], { type: 'audio/wav' });
      const voice = new LocalVoiceConversation({
        health: async () => ({ available: true }),
        transcribe: async (blob: Blob) => { calls.push(`transcribe:${blob.type}`); return 'Hello'; },
        chat: async () => { calls.push('chat'); return 'Hello there.'; },
        speech: async () => { calls.push('speech'); return audio; },
      }, (event: unknown) => events.push(event), browserLocalAudio);
      state.voiceTest = { voice, events, calls, tracks: () => stream?.getTracks().map((track) => track.readyState) };
      return voice.start();
    }, wav.toString('base64'));
    await expect.poll(() => page.evaluate(() => window.voiceTest.calls), { timeout: 15000 }).toContain('speech');
    await expect.poll(() => page.evaluate(() => window.voiceTest.voice.state)).toBe('assistant-speaking');
    await page.evaluate(() => window.voiceTest.voice.interrupt());
    expect(await page.evaluate(() => window.voiceTest.voice.state)).toBe('listening');
    expect(await page.evaluate(() => window.voiceTest.tracks())).toEqual(['live']);
    await page.evaluate(() => window.voiceTest.voice.end());
    expect(await page.evaluate(() => window.voiceTest.tracks())).toEqual(['ended']);
    expect(await page.evaluate(() => window.voiceTest.voice.state)).toBe('ended');
    expect(await page.evaluate(() => window.voiceTest.calls)).toEqual(['transcribe:audio/wav', 'chat', 'speech']);
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
