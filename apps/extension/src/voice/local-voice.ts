import { parseDeferredTask } from '../agent/deferred-tasks';
import { parseNativeBrowserCommand } from '../tabs/native-browser';
import type { VoiceEvent, VoiceSessionState } from '@nudge/contracts';

export type LocalVoiceMessage = { role: 'user' | 'assistant'; content: string };
type Api = {
  health(signal: AbortSignal): Promise<{ available: boolean; error?: string }>;
  prepare?(signal: AbortSignal): Promise<void>;
  transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
  chat(messages: LocalVoiceMessage[], signal: AbortSignal): Promise<string>;
  chatStream?(
    messages: LocalVoiceMessage[],
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<string>;
  speech(text: string, signal: AbortSignal): Promise<Blob>;
};
type AudioDependencies = {
  capture(onAudio: (samples: Float32Array, sampleRate: number) => void): Promise<() => void>;
  play(audio: Blob, signal: AbortSignal): Promise<void>;
};

/** Keep complete sentences together, with a bounded phrase for unusually long sentences. */
export class SpokenPhrases {
  #text = '';
  #first = true;
  push(text: string, final = false): string[] {
    this.#text += text;
    const phrases: string[] = [];
    while (this.#text.length) {
      const end = /[.!?](?:["”']?)(?=\s)/.exec(this.#text);
      let length = end ? end.index + end[0].length : 0;
      if (!length && this.#first && this.#text.length >= 70) {
        const clause = /[,;:](?=\s)/.exec(this.#text.slice(35, 120));
        if (clause) length = 35 + clause.index + 1;
      }
      if (!length && this.#text.length > (this.#first ? 110 : 180)) {
        length = this.#text.lastIndexOf(' ', this.#first ? 110 : 180);
        if (length < 1) length = this.#first ? 110 : 180;
      }
      if (!length && final) length = this.#text.length;
      if (!length) break;
      const phrase = this.#text.slice(0, length).trim();
      this.#text = this.#text.slice(length).trimStart();
      if (phrase) {
        phrases.push(phrase);
        this.#first = false;
      }
    }
    return phrases;
  }
}

/** A short pre-roll preserves consonants; sustained speech avoids reacting to clicks. */
export class SpeechSegmenter {
  #chunks: Float32Array[] = [];
  #samples = 0;
  #voiced = 0;
  #silence = 0;
  #started = false;
  #previewAt = 0;
  #unfinished = false;
  constructor(private readonly rate: number) {}
  setTranscript(text: string) {
    this.#unfinished =
      /\b(?:can you|could you|would you|will you|please|i want(?: you)?(?: to)?|i would like(?: you)?(?: to)?|and|or|because|to|the|a|an)\s*[,.]?$/i.test(
        text.trim(),
      );
  }
  push(samples: Float32Array): { started: boolean; audio?: Blob; partial?: Blob } {
    if (!samples.length) return { started: false };
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
    const loud = rms > 0.018;
    this.#chunks.push(samples);
    this.#samples += samples.length;
    this.#voiced = loud ? this.#voiced + samples.length : this.#voiced;
    this.#silence = loud ? 0 : this.#silence + samples.length;
    const started = !this.#started && this.#voiced >= this.rate * 0.25;
    this.#started ||= started;
    if (!this.#started && !loud) {
      if (this.#silence > this.rate * 0.18) this.#voiced = 0;
      // Retain a real rolling pre-roll instead of dropping the initial consonant at a reset boundary.
      let excess = this.#samples - Math.round(this.rate * 0.3);
      while (excess > 0 && this.#chunks.length) {
        const first = this.#chunks[0]!;
        const removed = Math.min(first.length, excess);
        if (removed === first.length) this.#chunks.shift();
        else this.#chunks[0] = first.slice(removed);
        this.#samples -= removed;
        excess -= removed;
      }
      return { started };
    }
    const ending = this.#unfinished ? 2.2 : this.#voiced < this.rate * 1.5 ? 1.8 : 1.1;
    if (this.#started && (this.#silence >= this.rate * ending || this.#samples >= this.rate * 25)) {
      const audio = pcmWav(this.#chunks, this.rate);
      this.#chunks = [];
      this.#samples = 0;
      this.#voiced = 0;
      this.#silence = 0;
      this.#started = false;
      this.#previewAt = 0;
      this.#unfinished = false;
      return { started, audio };
    }
    if (
      this.#started &&
      this.#voiced >= this.rate * 1.2 &&
      this.#samples - this.#previewAt >= this.rate * 2 &&
      this.#silence < this.rate * 0.3
    ) {
      this.#previewAt = this.#samples;
      return { started, partial: pcmWav(this.#chunks, this.rate) };
    }
    return { started };
  }
}

function pcmWav(chunks: Float32Array[], rate: number): Blob {
  const count = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const word = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  word(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, 'data');
  view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const value of chunk) {
      view.setInt16(offset, Math.max(-1, Math.min(1, value)) * 32767, true);
      offset += 2;
    }
  return new Blob([bytes], { type: 'audio/wav' });
}

export const browserLocalAudio: AudioDependencies = {
  async capture(onAudio) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      // Fixed-size PCM callbacks keep segmentation independent of display frame rate.
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) =>
        onAudio(
          new Float32Array(event.inputBuffer.getChannelData(0)),
          event.inputBuffer.sampleRate,
        );
      source.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
      return () => {
        processor.onaudioprocess = null;
        source.disconnect();
        processor.disconnect();
        silent.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context?.close();
      };
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      void context?.close();
      throw error;
    }
  },
  async play(blob, signal) {
    if (signal.aborted) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          audio.pause();
          signal.removeEventListener('abort', abort);
          audio.onended = null;
          audio.onerror = null;
        };
        const abort = () => {
          cleanup();
          resolve();
        };
        signal.addEventListener('abort', abort, { once: true });
        audio.onended = () => {
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          cleanup();
          reject(new Error('Local voice audio could not play.'));
        };
        void audio.play().catch((error) => {
          cleanup();
          reject(error);
        });
      });
    } finally {
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    }
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
  #messages: LocalVoiceMessage[] = [];
  #response: string | undefined;
  #utteranceId: string | undefined;
  #previewAbort: AbortController | undefined;
  #previewRunning = false;
  #latestPreview: { audio: Blob; itemId: string } | undefined;
  #transcriptionTail: Promise<void> = Promise.resolve();
  constructor(
    private readonly api: Api,
    private readonly emit: (event: VoiceEvent) => void,
    private readonly audio = browserLocalAudio,
    private readonly instruction: (text: string) => boolean = () => false,
  ) {}
  get active() {
    return this.#active;
  }
  get state() {
    return this.#state;
  }
  #setState(state: VoiceSessionState) {
    this.#state = state;
    this.emit({ type: 'state', state });
  }
  async start() {
    if (this.#active) return;
    this.#active = true;
    this.#muted = false;
    this.#messages = [];
    const epoch = ++this.#epoch;
    this.#session = new AbortController();
    this.#setState('connecting');
    try {
      const health = await this.api.health(this.#session.signal);
      if (epoch !== this.#epoch) return;
      if (!health.available)
        throw new Error(health.error || 'Local voice is not ready. Run the local voice setup.');
      await this.api.prepare?.(this.#session.signal);
      if (epoch !== this.#epoch) return;
      const stop = await this.audio.capture((samples, rate) => {
        if (!this.#active || this.#muted || epoch !== this.#epoch) return;
        this.#segmenter ??= new SpeechSegmenter(rate);
        const segment = this.#segmenter.push(samples);
        if (segment.started) {
          this.interrupt();
          this.#utteranceId = crypto.randomUUID();
          this.#setState('user-speaking');
        }
        if (segment.partial && this.#utteranceId)
          void this.#preview(segment.partial, this.#utteranceId);
        if (segment.audio) {
          const itemId = this.#utteranceId;
          this.#utteranceId = undefined;
          void this.#turn(segment.audio, itemId);
        }
      });
      if (epoch !== this.#epoch) {
        stop();
        return;
      }
      this.#stop = stop;
      this.#setState('listening');
    } catch (error) {
      if (epoch !== this.#epoch) return;
      await this.end();
      this.#setState('failed');
      this.#error(error);
    }
  }
  async end() {
    this.#active = false;
    ++this.#epoch;
    this.#session?.abort();
    this.interrupt();
    this.#stop?.();
    this.#stop = undefined;
    this.#segmenter = undefined;
    this.#setState('ended');
  }
  interrupt(resetState = true) {
    this.#previewAbort?.abort();
    this.#latestPreview = undefined;
    this.#pending?.abort();
    this.#pending = undefined;
    if (this.#response)
      this.emit({ type: 'speech.interrupted', role: 'assistant', responseId: this.#response });
    this.#response = undefined;
    if (this.#active && resetState) this.#setState('listening');
  }
  setMuted(muted: boolean) {
    this.#muted = muted;
    this.#segmenter = undefined;
    if (muted) this.interrupt();
  }
  sendText(text: string) {
    if (this.#active && text.trim()) void this.#turn(text);
  }
  speakMilestone(text: string) {
    if (!this.#active || this.#pending || this.#state === 'user-speaking') return;
    void this.#speak(text);
  }
  async #speak(text: string) {
    const pending = new AbortController();
    this.#pending = pending;
    try {
      const wav = await this.api.speech(text, pending.signal);
      if (!this.#active || pending.signal.aborted) return;
      this.#setState('assistant-speaking');
      await this.audio.play(wav, pending.signal);
    } catch (error) {
      if (!pending.signal.aborted) this.#error(error);
    } finally {
      if (this.#pending === pending) {
        this.#pending = undefined;
        if (this.#active) this.#setState('listening');
      }
    }
  }
  #error(error: unknown) {
    this.emit({
      type: 'error',
      message: error instanceof Error ? error.message : 'Local voice failed.',
    });
  }
  #transcribe(audio: Blob, signal: AbortSignal): Promise<string> {
    const result = this.#transcriptionTail.then(() => {
      signal.throwIfAborted();
      return this.api.transcribe(audio, signal);
    });
    this.#transcriptionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async #preview(audio: Blob, itemId: string) {
    this.#latestPreview = { audio, itemId };
    if (this.#previewRunning) return;
    this.#previewRunning = true;
    try {
      while (this.#latestPreview && this.#active) {
        const preview = this.#latestPreview;
        this.#latestPreview = undefined;
        const abort = new AbortController();
        this.#previewAbort = abort;
        try {
          const text = (await this.#transcribe(preview.audio, abort.signal)).trim();
          if (
            text &&
            !abort.signal.aborted &&
            this.#active &&
            this.#utteranceId === preview.itemId
          ) {
            this.#segmenter?.setTranscript(text);
            this.emit({
              type: 'transcript',
              role: 'user',
              text,
              final: false,
              replace: true,
              itemId: preview.itemId,
            });
          }
        } catch {
          /* Interim recognition is best effort; final transcription remains authoritative. */
        }
      }
    } finally {
      this.#previewRunning = false;
    }
  }
  async #turn(input: Blob | string, itemId: string = crypto.randomUUID()) {
    this.interrupt(false);
    const pending = new AbortController();
    this.#pending = pending;
    const live = () => this.#active && !pending.signal.aborted;
    try {
      const text =
        typeof input === 'string'
          ? input.trim()
          : (await this.#transcribe(input, pending.signal)).trim();
      if (!live() || !text) return;
      this.emit({
        type: 'transcript',
        role: 'user',
        text,
        final: true,
        itemId,
      });
      if (this.instruction(text)) return;
      const history = boundedLocalHistory([...this.#messages, { role: 'user', content: text }]);
      const responseId = crypto.randomUUID();
      this.#response = responseId;
      const phrases = new SpokenPhrases();
      let playback = Promise.resolve();
      let synthesis = Promise.resolve();
      let playbackError: unknown;
      const enqueue = (text: string) => {
        // Generate at most one phrase ahead while the previous phrase plays.
        // Synthesis stays serial; no unbounded queue of audio/model jobs.
        const previousPlayback = playback;
        const audio = synthesis.then(async () => {
          if (!live() || playbackError) return undefined;
          return this.api.speech(text, pending.signal);
        });
        synthesis = Promise.all([previousPlayback, audio]).then(
          () => undefined,
          (error: unknown) => {
            playbackError = error;
          },
        );
        playback = previousPlayback
          .then(async () => {
            const wav = await audio;
            if (!live() || !wav || playbackError) return;
            this.#setState('assistant-speaking');
            await this.audio.play(wav, pending.signal);
          })
          .catch((error: unknown) => {
            playbackError = error;
          });
      };
      const reply = this.api.chatStream
        ? await this.api.chatStream(history, pending.signal, (text) => {
            if (live()) {
              this.emit({
                type: 'transcript',
                role: 'assistant',
                text,
                final: false,
                itemId: responseId,
                responseId,
              });
              phrases.push(text).forEach(enqueue);
            }
          })
        : await this.api.chat(history, pending.signal);
      if (!live()) return;
      phrases.push(this.api.chatStream ? '' : reply, true).forEach(enqueue);
      this.#messages = [...history, { role: 'assistant', content: reply }];
      this.emit({
        type: 'transcript',
        role: 'assistant',
        text: reply,
        final: true,
        itemId: responseId,
        responseId,
      });
      await playback;
      if (playbackError) throw playbackError;
      if (!live()) return;
      this.emit({ type: 'speech.stopped', role: 'assistant', responseId });
      this.#response = undefined;
    } catch (error) {
      if (live()) this.#error(error);
      pending.abort();
    } finally {
      if (this.#pending === pending) {
        this.#pending = undefined;
        if (this.#active) this.#setState('listening');
      }
    }
  }
}

/** Route direct browser commands, not discussion about commands, through normal task validation. */
export function localBrowserInstruction(text: string, taskActive: boolean): string | undefined {
  const raw = text.trim();
  if (parseNativeBrowserCommand(raw)) return raw;
  const invocation = raw.match(/^(?:nudge|notch)(?:[,!:.]|\s)\s*(.+)$/i);
  if (invocation?.[1]) return invocation[1].trim();
  if (taskActive && /^(stop|pause|resume)[.!?]?$/i.test(raw)) return raw;
  const command = raw
    .replace(/^(?:sure|okay|ok|yes)[,!]?\s+/i, '')
    .replace(/^(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (parseDeferredTask(command, Date.now()).kind !== 'ordinary') return raw;
  if (
    /^(?:replace|change|update|correct|edit)\b.+\b(?:form|field|input|email address|name)\b/i.test(
      command,
    )
  )
    return raw;
  if (
    /^(?:fill|complete|submit)\s+(?:(?:in|out)\s+)?(?:(?:this|the|my|that|an?)\s+)?(?:contact\s+|job\s+)?(?:form|application|field)\b/i.test(
      command,
    ) ||
    /^apply (?:for|to)\b/i.test(command) ||
    /^(?:type|enter)\s+.+\s+(?:in|into)\s+(?:(?:the|this|that)\s+)?(?:(?:name|email|search|message|address)\s+)?(?:field|box|input|form)\b/i.test(
      command,
    )
  )
    return raw;
  if (
    /^(?:schedule|book|create|add)\s+(?:(?:a|an|the)\s+)?(?:meeting|appointment|event)\b/i.test(
      command,
    )
  )
    return raw;
  // Questions about the actual page need observations, never conversational guesses.
  const pageReference =
    /\b(?:this|current|that) (?:page|site|website|tab)\b|\b(?:page|site|website) (?:I am|I'm|I’m) (?:looking at|on)\b/i.test(
      command,
    );
  if (pageReference && !/^(?:do not|don't|don’t|never)\b/i.test(command)) return raw;
  if (taskActive && /^(?:yes|no|the \w+ one|\d+|i meant|instead|actually|like on)\b/i.test(command))
    return raw;
  // Creative requests remain conversation; shopping/research imperatives use the browser.
  if (
    /^(?:find(?: me)?|look for|search for|compare|filter(?: by)?|sort(?: by)?)\s+\S/i.test(
      command,
    ) &&
    !/\b(?:story|joke|poem|riddle|metaphor)\b/i.test(command)
  )
    return raw;
  // A general capability question has no destination to act on.
  if (/^(?:open|visit|navigate to)\s+(?:websites?|sites?|web pages?)$/i.test(command))
    return undefined;
  if (
    /^(?:open|visit|navigate to|go to|click|tap|scroll|search(?: the web)? for|search the web|switch to)\s+\S/i.test(
      command,
    )
  )
    return raw;
  if (
    /^(?:refresh|reload)(?: (?:this|the|current) (?:page|tab))?$|^go (?:back|forward)$|^close (?:this|the|current) tab$/i.test(
      command,
    )
  )
    return raw;
  return undefined;
}

export function boundedLocalHistory(messages: LocalVoiceMessage[]): LocalVoiceMessage[] {
  const bounded = messages
    .slice(-12)
    .map((message) => ({ ...message, content: message.content.slice(0, 4000) }));
  let size = bounded.reduce((sum, message) => sum + message.content.length, 0);
  while (size > 10000 && bounded.length > 1) size -= bounded.shift()!.content.length;
  return bounded;
}
