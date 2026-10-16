import type { ConversationTurn, VoiceEvent } from '@nudge/contracts';

import { RealtimeTranscriptReducer } from './realtime-transcript';

export function createVoiceConversation(dependencies: {
  addTurn(turn: ConversationTurn): void;
  setLiveTranscript(text: string): void;
}) {
  const reducer = new RealtimeTranscriptReducer();
  const committed = new Set<string>();

  return {
    handle(event: VoiceEvent): void {
      for (const update of reducer.apply(event)) {
        dependencies.setLiveTranscript(update.text);
        if (!update.final || committed.has(update.itemId)) continue;
        committed.add(update.itemId);
        dependencies.addTurn({
          id: crypto.randomUUID(),
          role: update.role,
          text: update.text,
          createdAt: new Date().toISOString(),
        });
      }
    },
  };
}

export function routeComposerText(
  text: string,
  dependencies: {
    voiceActive: boolean;
    sendRealtimeText(value: string): void;
    sendTextTask(value: string): void;
  },
): void {
  if (dependencies.voiceActive) dependencies.sendRealtimeText(text);
  else dependencies.sendTextTask(text);
}
