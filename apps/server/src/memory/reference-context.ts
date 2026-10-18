export interface MemoryReference {
  kind: string;
  id: string;
  title: string;
  text: string;
  source: string;
  updatedAt: string;
}
import type { CandidateProfile } from '@nudge/contracts';

import { profileSummary } from './candidate-profile';

export interface ReferenceStore {
  candidateProfile?(): CandidateProfile;
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
  /\b(?:apply|applying|application|cv|resume|résumé|profile|job|career|role|position|posting|vacanc\w*|hiring|candidate|fill(?:\s+out|\s+in)?|form|details|personal|contact\s+info\w*|sign\s*up|register|onboard\w*|greenhouse|lever|workday|ashby|smartrecruiters)\b/i;
const BUDGET = 7_600;

function documentRank(filename: string) {
  if (/\b(?:cv|resume|résumé)\b/i.test(filename)) return 2;
  if (/\b(?:profile|cover|letter)\b/i.test(filename)) return 1;
  return 0;
}

/**
 * Saved content is reference data, never authorization for a new browser action.
 * A failure to read the store is reported as such, so the agent never turns a
 * retrieval failure into "you have not provided this information".
 */
export function referenceContext(
  store: ReferenceStore,
  query: string,
  options: { includeChatHistory?: boolean } = {},
): string {
  try {
    return buildReferenceContext(store, query, options);
  } catch (error) {
    return JSON.stringify({
      retrievalError: `Saved profile and documents could not be read (${error instanceof Error ? error.message.slice(0, 160) : 'unknown error'}). Tell the user retrieval failed and to check that the Nudge server is running; do not say the information is missing.`,
    });
  }
}

function buildReferenceContext(
  store: ReferenceStore,
  query: string,
  options: { includeChatHistory?: boolean },
): string {
  const facts = store.listFacts().map(({ key, value, source }) => ({ key, value, source }));
  const application = APPLICATION.test(query);
  const result: {
    candidateProfile?: Record<string, unknown>;
    facts: typeof facts;
    references: MemoryReference[];
  } = {
    facts: [],
    references: [],
  };
  if (application && store.candidateProfile) {
    const profile = store.candidateProfile();
    if (profile.status !== 'no_documents' || Object.keys(profile.fields).length)
      result.candidateProfile = profileSummary(profile);
  }
  const references = store
    .search(query)
    .filter((item) => options.includeChatHistory !== false || item.kind !== 'message')
    .slice(0, 5);
  if (application) {
    const selectedId = result.candidateProfile ? store.candidateProfile?.().selectedDocumentId : undefined;
    const saved = [...(store.listDocuments?.() ?? [])].sort(
      (left, right) =>
        Number(right.id === selectedId) - Number(left.id === selectedId) ||
        documentRank(right.filename) - documentRank(left.filename),
    );
    // The full structured profile is available through tools; excerpts here are a head start.
    for (const document of saved.slice(0, 2)) {
      const existing = references.find((item) => item.kind === 'document' && item.id === document.id);
      const text = document.text.slice(0, 2_400);
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
    if (JSON.stringify(result).length <= BUDGET) return;
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
    pack('references', { ...item, text: item.text.slice(0, application && item.kind === 'document' ? 2_400 : 800) });
  }
  return JSON.stringify(result);
}

export { MEMORY_REFERENCE_RULES } from '@nudge/core';
