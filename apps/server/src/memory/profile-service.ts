import type { CandidateProfile } from '@nudge/contracts';

import { looksLikeCv } from './candidate-profile';
import type { MemoryStore } from './memory-store';

type ProfileStore = Pick<MemoryStore, 'listDocuments' | 'listFacts' | 'documentMeta' | 'candidateProfile'>;

/** The signed-in user's profile: built only from this local store's documents and facts. */
export function candidateProfileFor(store: ProfileStore): CandidateProfile {
  return store.candidateProfile();
}

export interface CvSearchResult {
  documentId: string;
  filename: string;
  excerpt: string;
}

/** Line-level search across saved CVs (selected/default first) with one line of context. */
export function searchCv(store: ProfileStore, query: string, limit = 8): CvSearchResult[] {
  const profile = candidateProfileFor(store);
  const tokens = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}+#.]{2,}/gu) ?? [])].slice(0, 12);
  if (!tokens.length) return [];
  const documents = store
    .listDocuments()
    .filter((document) => looksLikeCv(document) || document.id === profile.selectedDocumentId)
    .sort((a, b) => Number(b.id === profile.selectedDocumentId) - Number(a.id === profile.selectedDocumentId));
  const hits: Array<CvSearchResult & { score: number }> = [];
  for (const document of documents) {
    const lines = document.text.split(/\r?\n/).map((line) => line.trim());
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      const score = tokens.filter((token) => lower.includes(token)).length;
      if (!score) return;
      const excerpt = [lines[index - 1], line, lines[index + 1]].filter(Boolean).join('\n').slice(0, 600);
      hits.push({ documentId: document.id, filename: document.filename, excerpt, score });
    });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit);
}
