import { describe, expect, it } from 'vitest';
import type { ScopeResponse } from '@nudge/contracts';
import { normalizeLocalScope } from './local-scope';
const scope: ScopeResponse = {
  requestId: 'model',
  goal: 'Search this website',
  proposal: {
    origins: ['https://shop.test/search'],
    categories: ['read', 'navigate'],
    destinations: [],
    exclusions: [],
    limits: {},
  },
};
describe('local scope normalization', () => {
  it('permits typing for an explicitly requested website search and canonicalizes the site scope', () => {
    const result = normalizeLocalScope(
      {
        requestId: 'real',
        instruction:
          'Search this website for Cedar Observatory, open its opening hours result, and tell me its Saturday opening hours.',
        tabs: [],
      },
      scope,
    );
    expect(result.requestId).toBe('real');
    expect(result.proposal.origins).toEqual(['https://shop.test']);
    expect(result.proposal.categories).toEqual(['read', 'navigate', 'fill']);
  });
  it('does not grant consequential permissions and respects explicit no-entry constraints', () => {
    const normalize = (instruction: string) =>
      normalizeLocalScope({ requestId: 'real', instruction, tabs: [] }, scope).proposal.categories;
    expect(normalize('Draft an email but do not send it')).toEqual(['read', 'navigate', 'fill']);
    expect(normalize('Find the price without typing into anything')).not.toContain('fill');
    expect(normalize('Summarize this page')).not.toContain('fill');
  });
});

it('resolves current-page labels only to the explicitly bound real tab', () => {
  const request = {
    requestId: 'scope',
    originTabId: 7,
    instruction: 'Fill this form',
    tabs: [
      { tabId: 7, title: 'Calendar', url: 'https://calendar.test/form' },
      { tabId: 8, title: 'Other', url: 'https://other.test' },
    ],
  };
  const response = { ...scope, proposal: { ...scope.proposal, origins: ['this/current page'] } };
  expect(normalizeLocalScope(request, response).proposal.origins).toEqual([
    'https://calendar.test',
  ]);
  expect(() => normalizeLocalScope({ ...request, originTabId: 99 }, response)).toThrow();
  expect(() =>
    normalizeLocalScope(request, {
      ...scope,
      proposal: { ...scope.proposal, origins: ['some random site'] },
    }),
  ).toThrow();
});
