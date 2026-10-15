export class ElementRegistry {
  readonly #documentId: string;
  readonly #byId = new Map<string, Element>();
  readonly #byElement = new WeakMap<Element, string>();
  #sequence = 0;

  constructor(documentId: string) {
    this.#documentId = documentId;
  }

  register(element: Element): string {
    const existing = this.#byElement.get(element);
    if (existing) return existing;
    this.#sequence += 1;
    const id = `${this.#documentId}:${this.#sequence}`;
    this.#byId.set(id, element);
    this.#byElement.set(element, id);
    return id;
  }

  resolve(id: string): Element | undefined {
    if (!id.startsWith(`${this.#documentId}:`)) return undefined;
    return this.#byId.get(id);
  }

  belongsToDocument(id: string): boolean {
    return id.startsWith(`${this.#documentId}:`);
  }
}
