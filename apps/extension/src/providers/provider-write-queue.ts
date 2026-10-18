/** Serialize backend and saved preference writes; superseded hydration cannot win. */
export class ProviderWriteQueue {
  #tail: Promise<unknown> = Promise.resolve();
  write(
    current: () => boolean,
    backend: () => Promise<void>,
    storage: () => Promise<void>,
  ): Promise<boolean> {
    const operation = this.#tail.then(async () => {
      if (!current()) return false;
      await backend();
      if (!current()) return false;
      await storage();
      return current();
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }
}
