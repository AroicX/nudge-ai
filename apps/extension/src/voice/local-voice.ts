import type { VoiceEvent, VoiceSessionState } from '@nudge/contracts';

type Message = { role: 'user' | 'assistant'; content: string };
type Api = {
  health(signal: AbortSignal): Promise<{ available: boolean; error?: string }>;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
  chat(messages: Message[], signal: AbortSignal): Promise<string>;
  speech(text: string, signal: AbortSignal): Promise<Blob>;
};
type AudioDependencies = {
  capture(onAudio: (samples: Float32Array, sampleRate: number) => void): Promise<() => void>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
};

/** A short pre-roll preserves consonants; sustained speech avoids reacting to clicks. */
export class SpeechSegmenter {
  #chunks: Float32Array[] = [];
  #samples = 0;
  #voiced = 0;
  #silence = 0;
  #started = false;
  constructor(private readonly rate: number) {}
  push(samples: Float32Array): { started: boolean; audio?: Blob } {
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    const loud = rms > 0.018;
    this.#chunks.push(samples);
    this.#samples += samples.length;
    this.#voiced = loud ? this.#voiced + samples.length : this.#voiced;
    this.#silence = loud ? 0 : this.#silence + samples.length;
    const started = !this.#started && this.#voiced >= this.rate * 0.25;
    this.#started ||= started;
    if (this.#silence >= this.rate * 0.7 || this.#samples >= this.rate * 25) {
      const audio = this.#started ? pcmWav(this.#chunks, this.rate) : undefined;
      this.#chunks = []; this.#samples = 0; this.#voiced = 0; this.#silence = 0; this.#started = false;
      return audio ? { started, audio } : { started };
    }
    return { started };
  }
}

function pcmWav(chunks: Float32Array[], rate: number): Blob {
  const count = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const word = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const value of chunk) {
    view.setInt16(offset, Math.max(-1, Math.min(1, value)) * 32767, true); offset += 2;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export const browserLocalAudio: AudioDependencies = {
  async capture(onAudio) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      // Fixed-size PCM callbacks keep segmentation independent of display frame rate.
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain(); silent.gain.value = 0;
      processor.onaudioprocess = (event) => onAudio(new Float32Array(event.inputBuffer.getChannelData(0)), event.inputBuffer.sampleRate);
      source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      return () => { processor.onaudioprocess = null; source.disconnect(); processor.disconnect(); silent.disconnect(); stream.getTracks().forEach((track) => track.stop()); void context?.close(); };
    } catch (error) { stream.getTracks().forEach((track) => track.stop()); void context?.close(); throw error; }
  },
  async play(blob, signal) {
    if (signal.aborted) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { audio.pause(); signal.removeEventListener('abort', abort); audio.onended = null; audio.onerror = null; };
        const abort = () => { cleanup(); resolve(); };
        signal.addEventListener('abort', abort, { once: true });
        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); reject(new Error('Local voice audio could not play.')); };
        void audio.play().catch((error) => { cleanup(); reject(error); });
      });
    } finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
  },
};

export class LocalVoiceConversation {
  #state: VoiceSessionState = 'idle';
  #epoch = 0;
  #active = false;
  #muted = false;
  #stop: (() => void) | undefined;
  #pending: AbortController | undefined;
  #session: AbortController | undefined;
  #segmenter: SpeechSegmenter | undefined;
  #messages: Message[] = [];
  #response: string | undefined;
  constructor(private readonly api: Api, private readonly emit: (event: VoiceEvent) => void, private readonly audio = browserLocalAudio, private readonly instruction: (text: string) => boolean = () => false) {}
  get active() { return this.#active; }
  get state() { return this.#state; }
  #setState(state: VoiceSessionState) { this.#state = state; this.emit({ type: 'state', state }); }
  async start() {
    if (this.#active) return;
    this.#active = true; this.#muted = false; this.#messages = [];
    const epoch = ++this.#epoch;
    this.#session = new AbortController();
    this.#setState('connecting');
    try {
      const health = await this.api.health(this.#session.signal);
      if (epoch !== this.#epoch) return;
      if (!health.available) throw new Error(health.error || 'Local voice is not ready. Run the local voice setup.');
      const stop = await this.audio.capture((samples, rate) => {
        if (!this.#active || this.#muted || epoch !== this.#epoch) return;
        this.#segmenter ??= new SpeechSegmenter(rate);
        const segment = this.#segmenter.push(samples);
        if (segment.started) { this.interrupt(); this.#setState('user-speaking'); }
        if (segment.audio) void this.#turn(segment.audio);
      });
      if (epoch !== this.#epoch) { stop(); return; }
      this.#stop = stop; this.#setState('listening');
    } catch (error) {
      if (epoch !== this.#epoch) return;
      await this.end(); this.#setState('failed'); this.#error(error);
    }
  }
  async end() {
    this.#active = false; ++this.#epoch; this.#session?.abort(); this.interrupt();
    this.#stop?.(); this.#stop = undefined; this.#segmenter = undefined;
    this.#setState('ended');
  }
  interrupt() {
    this.#pending?.abort(); this.#pending = undefined;
    if (this.#response) this.emit({ type: 'speech.interrupted', role: 'assistant', responseId: this.#response });
    this.#response = undefined;
    if (this.#active) this.#setState('listening');
  }
  setMuted(muted: boolean) { this.#muted = muted; this.#segmenter = undefined; if (muted) this.interrupt(); }
  sendText(text: string) { if (this.#active && text.trim()) void this.#turn(text); }
  speakMilestone(text: string) {
    if (!this.#active || this.#pending || this.#state === 'user-speaking') return;
    void this.#speak(text);
  }
  async #speak(text: string) {
    const pending = new AbortController(); this.#pending = pending;
    try {
      const wav = await this.api.speech(text, pending.signal);
      if (!this.#active || pending.signal.aborted) return;
      this.#setState('assistant-speaking');
      await this.audio.play(wav, pending.signal);
    } catch (error) { if (!pending.signal.aborted) this.#error(error); }
    finally { if (this.#pending === pending) { this.#pending = undefined; if (this.#active) this.#setState('listening'); } }
  }
  #error(error: unknown) { this.emit({ type: 'error', message: error instanceof Error ? error.message : 'Local voice failed.' }); }
  async #turn(input: Blob | string) {
    this.interrupt();
    const pending = new AbortController(); this.#pending = pending;
    const live = () => this.#active && !pending.signal.aborted;
    try {
      const text = typeof input === 'string' ? input.trim() : (await this.api.transcribe(input, pending.signal)).trim();
      if (!live() || !text) return;
      this.emit({ type: 'transcript', role: 'user', text, final: true, itemId: crypto.randomUUID() });
      if (this.instruction(text)) return;
      const history = [...this.#messages, { role: 'user' as const, content: text }].slice(-12);
      const reply = await this.api.chat(history, pending.signal);
      if (!live()) return;
      this.#messages = [...history, { role: 'assistant', content: reply }];
      const responseId = crypto.randomUUID(); this.#response = responseId;
      this.emit({ type: 'transcript', role: 'assistant', text: reply, final: true, itemId: responseId, responseId });
      const wav = await this.api.speech(reply, pending.signal);
      if (!live()) return;
      this.#setState('assistant-speaking');
      await this.audio.play(wav, pending.signal);
      if (!live()) return;
      this.emit({ type: 'speech.stopped', role: 'assistant', responseId });
      this.#response = undefined;
    } catch (error) { if (live()) this.#error(error); }
    finally { if (this.#pending === pending) { this.#pending = undefined; if (this.#active) this.#setState('listening'); } }
  }
}

/** Only deliberate activation or exact active-task controls enter browser execution. */
export function localBrowserInstruction(text: string, taskActive: boolean): string | undefined {
  const invocation = text.trim().match(/^nudge(?:[,!:]|\s)\s*(.+)$/i);
  if (invocation?.[1]) return invocation[1].trim();
  if (taskActive && /^(stop|pause|resume)[.!?]?$/i.test(text.trim())) return text.trim();
  return undefined;
}
