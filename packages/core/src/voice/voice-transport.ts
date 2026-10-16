import type { VoiceEvent, VoiceSessionConfig, VoiceToolResult } from '@nudge/contracts';

export type VoiceEventListener = (event: VoiceEvent) => void;

export interface VoiceTransport {
  connect(config: VoiceSessionConfig): Promise<void>;
  disconnect(reason: string): Promise<void>;
  interrupt(): void;
  setMuted(muted: boolean): void;
  sendText(text: string): void;
  sendToolResult(callId: string, result: VoiceToolResult): void;
  /** Speak a short progress update without giving the voice model tool access. */
  speakMilestone?(text: string): void;
  subscribe(listener: VoiceEventListener): () => void;
}
