export class DocumentVersion {
  #id: string;

  constructor(id = `doc_${crypto.randomUUID()}`) {
    this.#id = id;
  }

  get id(): string {
    return this.#id;
  }

  rotate(id = `doc_${crypto.randomUUID()}`): string {
    this.#id = id;
    return id;
  }
}
