import type { ExtractedRecord } from '@nudge/contracts';

const TRACKING = /^(utm_.*|gclid|fbclid|mc_cid|mc_eid|_hsenc|_hsmi|ref_src)$/i;

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    let text = url.toString();
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
      text = url.toString();
    }
    if (url.pathname === '/' && !url.search) text = text.replace(/\/$/, '');
    return text;
  } catch {
    return value.trim();
  }
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const isUrl = (text: string) => /^https?:\/\//i.test(text.trim());

export interface RecordEvidence {
  texts: string[];
  hrefs: string[];
  values: string[];
}

export function groundRecord(fields: Record<string, string>, evidence: RecordEvidence): Record<string, string> {
  const corpus = collapse([...evidence.texts, ...evidence.values].join('\n'));
  const hrefs = new Set(evidence.hrefs.map(normalizeUrl));
  const grounded: Record<string, string> = {};
  for (const [name, raw] of Object.entries(fields)) {
    const value = raw.trim();
    if (!value || value.toLowerCase() === 'unknown') {
      grounded[name] = 'unknown';
      continue;
    }
    if (isUrl(value)) {
      grounded[name] = hrefs.has(normalizeUrl(value)) ? normalizeUrl(value) : 'unknown';
      continue;
    }
    grounded[name] = corpus.includes(collapse(value)) ? value : 'unknown';
  }
  return grounded;
}

export class RecordStore {
  readonly #records = new Map<string, ExtractedRecord>();
  #sequence = 0;

  constructor(
    readonly fields: string[],
    readonly keyField?: string,
  ) {}

  #keyFor(fields: Record<string, string>, sourceUrl: string): string {
    if (this.keyField && fields[this.keyField] && fields[this.keyField] !== 'unknown') {
      const value = fields[this.keyField]!;
      return isUrl(value) ? normalizeUrl(value) : collapse(value);
    }
    const urlField = Object.values(fields).find((value) => isUrl(value));
    return normalizeUrl(urlField ?? sourceUrl);
  }

  add(
    input: { fields: Record<string, string>; sourceUrl: string; observedAt: string },
    evidence: RecordEvidence,
  ): { added: boolean; record: ExtractedRecord } {
    const grounded = groundRecord(input.fields, { ...evidence, hrefs: [...evidence.hrefs, input.sourceUrl] });
    const key = this.#keyFor(grounded, input.sourceUrl);
    const existing = this.#records.get(key);
    if (existing) return { added: false, record: existing };
    this.#sequence += 1;
    const record: ExtractedRecord = {
      id: `rec_${this.#sequence}`,
      key,
      fields: grounded,
      sourceUrl: normalizeUrl(input.sourceUrl),
      observedAt: input.observedAt,
      saved: {},
    };
    this.#records.set(key, record);
    return { added: true, record };
  }

  list(): ExtractedRecord[] {
    return [...this.#records.values()];
  }

  markSaved(id: string, destination: NonNullable<ExtractedRecord['saved']['destination']>): void {
    for (const [key, record] of this.#records) {
      if (record.id === id) this.#records.set(key, { ...record, saved: { destination } });
    }
  }

  unsaved(): ExtractedRecord[] {
    return this.list().filter((record) => !record.saved.destination);
  }

  toJSON(): { fields: string[]; keyField?: string; records: ExtractedRecord[]; sequence: number } {
    return { fields: this.fields, ...(this.keyField ? { keyField: this.keyField } : {}), records: this.list(), sequence: this.#sequence };
  }

  static from(json: { fields: string[]; keyField?: string; records: ExtractedRecord[]; sequence?: number }): RecordStore {
    const store = new RecordStore(json.fields, json.keyField);
    for (const record of json.records) store.#records.set(record.key, record);
    store.#sequence = json.sequence ?? json.records.length;
    return store;
  }
}
