export class CancellationError extends Error {
  constructor() {
    super('Task was cancelled or superseded.');
    this.name = 'CancellationError';
  }
}

export class CancellationGate {
  #generation = 0;
  #controller = new AbortController();

  get generation(): number {
    return this.#generation;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  stop(): number {
    this.#controller.abort();
    this.#generation += 1;
    this.#controller = new AbortController();
    return this.#generation;
  }

  assertActive(generation: number): void {
    if (generation !== this.#generation) throw new CancellationError();
  }
}
