import { describe, expect, it, vi } from 'vitest';
import { LocalVoiceConversation, SpeechSegmenter } from './local-voice';

describe('local voice', () => {
  it('segments speech after silence and discards short noise', () => {
    const vad = new SpeechSegmenter(1000);
    expect(vad.push(new Float32Array(100).fill(0.2))).toMatchObject({ started: false });
    expect(vad.push(new Float32Array(200).fill(0.2))).toMatchObject({ started: true });
    expect(vad.push(new Float32Array(700))).toHaveProperty('audio');
    const noise = new SpeechSegmenter(1000);
    noise.push(new Float32Array(100).fill(0.2));
    expect(noise.push(new Float32Array(700))).not.toHaveProperty('audio');
  });
  it('aborts an in-flight reply on interruption and ignores stale results', async () => {
    let resolve!: (text: string) => void;
    const speech = vi.fn();
    const chat = vi.fn((_messages: unknown, _signal: AbortSignal) => new Promise<string>((done) => { resolve = done; }));
    const events = vi.fn();
    const voice = new LocalVoiceConversation({ health: async () => ({ available: true }), transcribe: async () => 'hello', chat, speech }, events, {
      capture: async () => () => {}, play: async () => {},
    });
    await voice.start();
    voice.sendText('hello');
    voice.interrupt();
    resolve('stale response');
    await Promise.resolve();
    expect(speech).not.toHaveBeenCalled();
    expect(chat.mock.calls[0]?.[1]?.aborted).toBe(true);
    await voice.end();
  });
  it('closes a microphone acquired after ending the call', async () => {
    let resolve!: (stop: () => void) => void;
    const stop = vi.fn();
    const voice = new LocalVoiceConversation({ health: async () => ({ available: true }), transcribe: vi.fn(), chat: vi.fn(), speech: vi.fn() }, vi.fn(), {
      capture: () => new Promise((done) => { resolve = done; }), play: async () => {},
    });
    const starting = voice.start();
    await Promise.resolve();
    await voice.end();
    resolve(stop);
    await starting;
    expect(stop).toHaveBeenCalledOnce();
  });
});
