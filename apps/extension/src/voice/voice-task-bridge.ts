import type { VoiceEvent } from '@nudge/contracts';

export interface VoiceTaskBridgeDependencies {
  /** Shared entry point with typed input; the controller classifies stop/pause/corrections. */
  instruct(text: string): void;
}

/**
 * Only final transcripts of the user's own speech become instructions. Assistant
 * speech, partial transcripts and model function calls never issue commands,
 * so voice playback cannot trigger browser actions.
 */
export function createVoiceTaskBridge(dependencies: VoiceTaskBridgeDependencies) {
  return (event: VoiceEvent): void => {
    if (event.type !== 'transcript' || event.role !== 'user' || !event.final) return;
    const text = event.text.trim();
    if (text) dependencies.instruct(text);
  };
}
