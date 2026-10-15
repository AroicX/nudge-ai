import type { VoiceEvent, VoiceSessionConfig } from '@nudge/contracts';

export type VoiceEventListener = (event: VoiceEvent) => void;

export interface VoiceTransport {
  connect(config: VoiceSessionConfig): Promise<void>;
  disconnect(reason: string): Promise<void>;
  interrupt(): void;
  setMuted(muted: boolean): void;
  sendText(text: string): void;
  /** Speak a short progress update; must never let the voice model call tools. */
  speakMilestone?(text: string): void;
  subscribe(listener: VoiceEventListener): () => void;
}
