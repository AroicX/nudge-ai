import type { ProviderSelection } from '@nudge/contracts';

/** An unresolved saved preference must never silently select cloud audio. */
export class VoiceProviderGate {
  #selection: ProviderSelection | undefined;
  #switching = false;
  get ready(): boolean {
    return this.#selection !== undefined;
  }
  set(selection: ProviderSelection): void {
    if (!this.#switching) this.#selection = selection;
  }
  beginSwitch(): boolean {
    if (this.#switching) return false;
    this.#switching = true;
    this.#selection = undefined;
    return true;
  }
  finishSwitch(selection?: ProviderSelection): void {
    this.#selection = selection;
    this.#switching = false;
  }
  requireLocal(): boolean {
    if (!this.#selection) throw new Error('Voice is waiting for your saved provider settings.');
    return this.#selection.provider === 'ollama';
  }
}
