export interface SecretBinding {
  taskId: string;
  destinationTabId: number;
  destinationDocumentId: string;
  elementId: string;
  cancellationGeneration: number;
}

export class SecretEnvelope {
  #secret: string | undefined;
  #used = false;
  #destroyed = false;

  private constructor(
    secret: string,
    private readonly binding: SecretBinding,
    private readonly createdAt: number,
    private readonly now: () => number,
  ) {
    this.#secret = secret;
  }

  static create(secret: string, binding: SecretBinding, now: () => number = Date.now) {
    if (!/^\d{4,8}$/.test(secret)) throw new Error('OTP must contain 4–8 digits.');
    return new SecretEnvelope(secret, { ...binding }, now(), now);
  }

  readOnce(binding: SecretBinding): string {
    if (this.#destroyed) throw new Error('Secret envelope was destroyed.');
    if (this.#used) throw new Error('Secret envelope was already used.');
    if (this.now() - this.createdAt > 120_000) {
      this.destroy();
      throw new Error('Secret envelope expired.');
    }
    if (
      binding.taskId !== this.binding.taskId ||
      binding.destinationTabId !== this.binding.destinationTabId ||
      binding.destinationDocumentId !== this.binding.destinationDocumentId ||
      binding.elementId !== this.binding.elementId ||
      binding.cancellationGeneration !== this.binding.cancellationGeneration
    ) {
      throw new Error('Secret envelope destination does not match.');
    }
    const secret = this.#secret!;
    this.#secret = undefined;
    this.#used = true;
    return secret;
  }

  destroy(): void {
    this.#secret = undefined;
    this.#destroyed = true;
  }

  toJSON() {
    return { protected: true };
  }
}
