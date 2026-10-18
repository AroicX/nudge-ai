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

const APPLICATION =
  /\b(?:apply|application|cv|resume|résumé|profile|job|career|fill(?:\s+out)?|form)\b/i;

function documentRank(filename: string) {
  if (/\b(?:cv|resume|résumé)\b/i.test(filename)) return 2;
  if (/\b(?:profile|cover|letter)\b/i.test(filename)) return 1;
  return 0;
}

/** Saved content is reference data, never authorization for a new browser action. */
export function referenceContext(
  store: ReferenceStore,
  query: string,
  options: { includeChatHistory?: boolean } = {},
): string {
  const facts = store.listFacts().map(({ key, value, source }) => ({ key, value, source }));
  const application = APPLICATION.test(query);
  const result: { facts: typeof facts; references: MemoryReference[] } = {
    facts: [],
    references: [],
  };
  const references = store
    .search(query)
    .filter((item) => options.includeChatHistory !== false || item.kind !== 'message')
    .slice(0, 5);
  if (application) {
    const saved = [...(store.listDocuments?.() ?? [])].sort(
      (left, right) => documentRank(right.filename) - documentRank(left.filename),
    );
    for (const document of saved.slice(0, 2)) {
      const existing = references.find((item) => item.kind === 'document' && item.id === document.id);
      const text = document.text.slice(0, 3200);
      if (existing) existing.text = text;
      else
        references.unshift({
          kind: 'document',
          id: document.id,
          title: document.filename,
          text,
          source: document.source,
          updatedAt: document.createdAt,
        });
    }
  }
  const pack = (kind: 'facts' | 'references', item: (typeof facts)[number] | MemoryReference) => {
    if (kind === 'facts') result.facts.push(item as (typeof facts)[number]);
    else result.references.push(item as MemoryReference);
    if (JSON.stringify(result).length <= 4000) return;
    if (kind === 'facts') result.facts.pop();
    else result.references.pop();
  };
  if (application) {
    for (const item of references.filter((item) => item.kind === 'document')) pack('references', item);
  }
  for (const fact of facts) {
    const before = result.facts.length;
    pack('facts', { ...fact, value: fact.value.slice(0, 400) });
    if (!application && result.facts.length === before) continue;
    if (!application && JSON.stringify({ facts: result.facts, references: [] }).length > 1800) {
      result.facts.pop();
    }
  }
  for (const item of references) {
    if (application && item.kind === 'document' && result.references.some((saved) => saved.id === item.id))
      continue;
    pack('references', { ...item, text: item.text.slice(0, application && item.kind === 'document' ? 3200 : 800) });
  }
  return JSON.stringify(result);
}

export { MEMORY_REFERENCE_RULES } from '@nudge/core';
