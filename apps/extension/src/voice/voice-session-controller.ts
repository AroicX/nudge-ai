import type {
  VoiceEvent,
  VoiceSessionConfig,
  VoiceSessionState,
  VoiceToolResult,
} from '@nudge/contracts';
import type { VoiceTransport } from '@nudge/core';

export class VoiceSessionController {
  #epoch = 0;
  #startPromise: Promise<void> | undefined;
  #state: VoiceSessionState = 'idle';

  constructor(
    private readonly transport: VoiceTransport,
    private readonly issueSession: (signal: AbortSignal) => Promise<VoiceSessionConfig>,
    private readonly onEvent: (event: VoiceEvent) => void = () => undefined,
  ) {
    transport.subscribe((event) => {
      if (event.type === 'state') this.#state = event.state;
      this.onEvent(event);
    });
  }

  get state(): VoiceSessionState {
    return this.#state;
  }

  get active(): boolean {
    return !['idle', 'ended', 'failed'].includes(this.#state);
  }

  start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise;
    const epoch = ++this.#epoch;
    const controller = new AbortController();
    this.#state = 'connecting';
    this.onEvent({ type: 'state', state: 'connecting' });
    this.#startPromise = (async () => {
      try {
        const config = await this.issueSession(controller.signal);
        if (epoch !== this.#epoch) return;
        await this.transport.connect(config);
        if (epoch !== this.#epoch) await this.transport.disconnect('superseded');
      } catch (error) {
        if (epoch === this.#epoch) {
          this.#state = 'failed';
          this.onEvent({ type: 'state', state: 'failed' });
          this.onEvent({
            type: 'error',
            message: error instanceof Error ? error.message : 'Voice could not start.',
          });
        }
      } finally {
        if (epoch === this.#epoch) this.#startPromise = undefined;
      }
    })();
    return this.#startPromise;
  }

  async end(): Promise<void> {
    this.#epoch += 1;
    this.#startPromise = undefined;
    await this.transport.disconnect('user-ended');
    this.#state = 'ended';
  }

  interrupt(): void {
    this.transport.interrupt();
  }
  setMuted(muted: boolean): void {
    this.transport.setMuted(muted);
  }
  sendText(text: string): void {
    this.transport.sendText(text);
  }
  sendToolResult(callId: string, result: VoiceToolResult): void {
    this.transport.sendToolResult(callId, result);
  }
}
