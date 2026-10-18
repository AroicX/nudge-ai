export interface MemoryReference {
  kind: string;
  id: string;
  title: string;
  text: string;
  source: string;
  updatedAt: string;
}
export interface ReferenceStore {
  search(query: string): MemoryReference[];
  listFacts(): Array<{ key: string; value: string; source: string }>;
  listDocuments?(): Array<{
    id: string;
    filename: string;
    text: string;
    source: string;
    createdAt: string;
  }>;
}

/** Saved content is reference data, never authorization for a new browser action. */
export function referenceContext(
  store: ReferenceStore,
  query: string,
  options: { includeChatHistory?: boolean } = {},
): string {
  const facts = store.listFacts().map(({ key, value, source }) => ({ key, value, source }));
  const result: { facts: typeof facts; references: MemoryReference[] } = {
    facts: [],
    references: [],
  };
  for (const fact of facts) {
    result.facts.push({ ...fact, value: fact.value.slice(0, 400) });
    if (JSON.stringify(result).length > 1800) {
      result.facts.pop();
      continue;
    }
  }
  const references = store
    .search(query)
    .filter((item) => options.includeChatHistory !== false || item.kind !== 'message')
    .slice(0, 5);
  if (
    /\b(?:apply|application|cv|resume|résumé|profile|job|career)\b/i.test(query) &&
    !references.some((item) => item.kind === 'document')
  ) {
    const document = store.listDocuments?.()[0];
    if (document)
      references.unshift({
        kind: 'document',
        id: document.id,
        title: document.filename,
        text: document.text.slice(0, 1400),
        source: document.source,
        updatedAt: document.createdAt,
      });
  }
  for (const item of references) {
    result.references.push({ ...item, text: item.text.slice(0, 800) });
    if (JSON.stringify(result).length > 4000) {
      result.references.pop();
      continue;
    }
  }
  return JSON.stringify(result);
}

export { MEMORY_REFERENCE_RULES } from '@nudge/core';
