import { contentRandomUUID } from './random-id';
export class DocumentVersion {
  #id: string;

  constructor(id = `doc_${contentRandomUUID()}`) {
    this.#id = id;
  }

  get id(): string {
    return this.#id;
  }

  rotate(id = `doc_${contentRandomUUID()}`): string {
    this.#id = id;
    return id;
  }
}
