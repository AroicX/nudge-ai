import type { VoiceEvent } from '@nudge/contracts';

export interface VoiceTranscriptUpdate {
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
  interrupted: boolean;
  itemId: string;
  responseId?: string;
}

export class RealtimeTranscriptReducer {
  readonly #seen = new Set<string>();
  readonly #items = new Map<string, VoiceTranscriptUpdate>();
  readonly #playedResponses = new Set<string>();
  readonly #interruptedResponses = new Set<string>();

  apply(event: VoiceEvent): VoiceTranscriptUpdate[] {
    const eventId = 'eventId' in event ? event.eventId : undefined;
    if (eventId && this.#seen.has(eventId)) return [];
    if (eventId) {
      this.#seen.add(eventId);
      if (this.#seen.size > 12_000) this.#seen.delete(this.#seen.values().next().value!);
    }

    if (event.type === 'speech.stopped' && event.role === 'assistant' && event.responseId) {
      this.#playedResponses.add(event.responseId);
      return this.#updateResponse(event.responseId, false);
    }

    if (event.type === 'speech.interrupted' && event.responseId) {
      this.#interruptedResponses.add(event.responseId);
      return this.#updateResponse(event.responseId, true);
    }

    if (event.type !== 'transcript') return [];
    const itemId = event.itemId ?? `${event.role}:${event.responseId ?? eventId ?? 'current'}`;
    const existing = this.#items.get(itemId);
    const interrupted = Boolean(
      event.responseId && this.#interruptedResponses.has(event.responseId),
    );
    const text = interrupted
      ? 'Reply interrupted'
      : event.final
        ? event.text
        : `${existing?.text ?? ''}${event.text}`;
    const update: VoiceTranscriptUpdate = {
      role: event.role,
      text,
      final:
        interrupted ||
        (event.role === 'user' && event.final) ||
        Boolean(event.responseId && this.#playedResponses.has(event.responseId)),
      interrupted,
      itemId,
      ...(event.responseId ? { responseId: event.responseId } : {}),
    };
    this.#items.set(itemId, update);
    return [{ ...update }];
  }

  #updateResponse(responseId: string, interrupted: boolean): VoiceTranscriptUpdate[] {
    const updates: VoiceTranscriptUpdate[] = [];
    for (const [itemId, item] of this.#items) {
      if (item.responseId !== responseId) continue;
      const update = {
        ...item,
        text: interrupted ? 'Reply interrupted' : item.text,
        final: true,
        interrupted,
      };
      this.#items.set(itemId, update);
      updates.push({ ...update });
    }
    return updates;
  }
}
