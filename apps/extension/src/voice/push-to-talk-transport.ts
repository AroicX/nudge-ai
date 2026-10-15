export function chooseRecorderMime(supported: (mime: string) => boolean): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(supported) ?? '';
}

export class PushToTalkTransport {
  #stream: MediaStream | undefined;
  #recorder: MediaRecorder | undefined;
  #chunks: Blob[] = [];
  #controller: AbortController | undefined;

  constructor(private readonly upload: (audio: Blob, signal: AbortSignal) => Promise<string>) {}

  async start(): Promise<void> {
    await this.cancel();
    this.#stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = chooseRecorderMime((mime) => MediaRecorder.isTypeSupported(mime));
    this.#recorder = new MediaRecorder(this.#stream, mimeType ? { mimeType } : undefined);
    this.#chunks = [];
    this.#recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) this.#chunks.push(event.data);
    });
    this.#recorder.start();
  }

  stop(): Promise<string> {
    const recorder = this.#recorder;
    if (!recorder || recorder.state === 'inactive')
      return Promise.reject(new Error('Recording is not active.'));
    return new Promise((resolve, reject) => {
      recorder.addEventListener(
        'stop',
        () => {
          this.#stream?.getTracks().forEach((track) => track.stop());
          this.#stream = undefined;
          this.#recorder = undefined;
          const audio = new Blob(this.#chunks, { type: recorder.mimeType || 'audio/webm' });
          this.#chunks = [];
          if (!audio.size) {
            reject(new Error('No speech was recorded.'));
            return;
          }
          this.#controller = new AbortController();
          this.upload(audio, this.#controller.signal)
            .then(resolve, reject)
            .finally(() => {
              this.#controller = undefined;
            });
        },
        { once: true },
      );
      recorder.stop();
    });
  }

  async cancel(): Promise<void> {
    this.#controller?.abort();
    this.#controller = undefined;
    if (this.#recorder && this.#recorder.state !== 'inactive') this.#recorder.stop();
    this.#recorder = undefined;
    this.#chunks = [];
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = undefined;
  }
}
