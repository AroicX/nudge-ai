import { SecretEnvelope } from '../security/secret-envelope';
import type { ContentPort } from './ports';
import type { OtpTransferPort } from './task-controller';

const STATUS_MESSAGES: Record<string, string> = {
  ambiguous: 'I found more than one possible code in the newest matching message. Which one should I use?',
  stale: 'The newest matching message is older than 15 minutes, so I did not use its code. Request a new code and ask again.',
  none: 'I could not find a recent message from that service with a code.',
};

/**
 * Moves a one-time code from a source tab to a verified destination field.
 * The code exists only inside a single-use SecretEnvelope in service-worker
 * memory and in the two content-script messages; it is never returned,
 * logged, checkpointed or sent to a model.
 */
export class OtpBroker implements OtpTransferPort {
  readonly #pending = new Set<SecretEnvelope>();
  #cancelGeneration = 0;

  constructor(
    private readonly content: ContentPort,
    private readonly now: () => number = Date.now,
  ) {}

  async #destinationOk(tabId: number, elementId: string, documentId: string): Promise<string | undefined> {
    const inspected = await this.content.send(tabId, { type: 'inspect', elementId });
    if (!inspected.ok || inspected.documentId !== documentId) return 'The verification page changed; I did not enter the code.';
    const element = inspected.element;
    if (!element || element.inputType === 'password') return 'That field is not a verification-code field.';
    if (element.autocomplete !== 'one-time-code' && !element.codeLike) return 'That field is not a verification-code field.';
    return undefined;
  }

  async transfer(input: Parameters<OtpTransferPort['transfer']>[0]): Promise<{ ok: boolean; detail: string }> {
    const cancelAt = this.#cancelGeneration;
    const cancelled = () => cancelAt !== this.#cancelGeneration;

    const destinationProblem = await this.#destinationOk(input.destinationTabId, input.destinationElementId, input.destinationDocumentId);
    if (destinationProblem) return { ok: false, detail: destinationProblem };
    if (cancelled()) return { ok: false, detail: 'Cancelled.' };

    const extraction = await this.content.send(input.sourceTabId, { type: 'otp_extract', service: input.service, now: this.now() });
    const status = extraction.otp?.status ?? 'none';
    if (status !== 'found' || !extraction.otp?.envelopeCode) {
      return { ok: false, detail: STATUS_MESSAGES[status] ?? STATUS_MESSAGES.none! };
    }
    const binding = {
      taskId: input.taskId,
      destinationTabId: input.destinationTabId,
      destinationDocumentId: input.destinationDocumentId,
      elementId: input.destinationElementId,
      cancellationGeneration: input.generation,
    };
    const envelope = SecretEnvelope.create(extraction.otp.envelopeCode, binding, this.now);
    this.#pending.add(envelope);
    try {
      const recheck = await this.#destinationOk(input.destinationTabId, input.destinationElementId, input.destinationDocumentId);
      if (recheck) return { ok: false, detail: recheck };
      if (cancelled()) return { ok: false, detail: 'Cancelled.' };
      const code = envelope.readOnce(binding);
      const entered = await this.content.send(input.destinationTabId, {
        type: 'otp_enter',
        elementId: input.destinationElementId,
        documentId: input.destinationDocumentId,
        envelopeCode: code,
      });
      return entered.ok
        ? { ok: true, detail: `Entered a ${entered.otp?.acceptedLength ?? 'complete'}-character code. The form was not submitted.` }
        : { ok: false, detail: 'The verification field did not accept the code.' };
    } catch {
      return { ok: false, detail: 'The code could not be transferred safely.' };
    } finally {
      envelope.destroy();
      this.#pending.delete(envelope);
    }
  }

  cancelAll(): void {
    this.#cancelGeneration += 1;
    for (const envelope of this.#pending) envelope.destroy();
    this.#pending.clear();
  }
}
