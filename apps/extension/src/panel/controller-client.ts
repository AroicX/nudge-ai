import { ControllerMessageSchema, type ControllerMessage, type PanelMessage } from '@nudge/contracts';

import type { PortLike } from '../agent/panel-bridge';

/** Side-panel side of the Port. Reconnects (and re-syncs state) if the service worker restarts. */
export class ControllerClient {
  #port: PortLike | undefined;
  #onMessage: ((message: ControllerMessage) => void) | undefined;
  #closed = false;

  constructor(private readonly connectPort: () => PortLike) {}

  connect(onMessage: (message: ControllerMessage) => void): void {
    this.#onMessage = onMessage;
    this.#closed = false;
    this.#open();
  }

  close(): void {
    this.#closed = true;
    this.#port = undefined;
  }

  #open(): void {
    const port = this.connectPort();
    this.#port = port;
    port.onMessage.addListener((raw) => {
      if (this.#port !== port) return;
      const parsed = ControllerMessageSchema.safeParse(raw);
      if (parsed.success) this.#onMessage?.(parsed.data);
    });
    port.onDisconnect.addListener(() => {
      if (this.#port !== port || this.#closed) return;
      this.#port = undefined;
      setTimeout(() => {
        if (!this.#closed && !this.#port) this.#open();
      }, 250);
    });
    port.postMessage({ type: 'hello' } satisfies PanelMessage);
  }

  #send(message: PanelMessage): void {
    if (!this.#port) this.#open();
    this.#port!.postMessage(message);
  }

  instruct(text: string, source: 'text' | 'voice', originTabId?: number): void {
    this.#send({ type: 'instruct', text: text.slice(0, 4_000), source, ...(originTabId !== undefined ? { originTabId } : {}) });
  }
  control(action: 'stop' | 'pause' | 'resume' | 'continue_budget'): void {
    this.#send({ type: 'control', action });
  }
  confirm(previewId: string, approved: boolean): void {
    this.#send({ type: 'confirm', previewId, approved });
  }
  answer(text: string): void {
    this.#send({ type: 'answer', text: text.slice(0, 4_000) });
  }
  capabilityGranted(): void {
    this.#send({ type: 'capability_granted', capability: 'trusted_input' });
  }
  approveFallback(approved: boolean): void {
    this.#send({ type: 'approve_fallback', approved });
  }
  requestExport(format: 'csv' | 'xlsx'): void {
    this.#send({ type: 'request_export', format });
  }
}
