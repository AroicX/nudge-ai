import type { ScopeRequest, ScopeResponse } from '@nudge/contracts';

/** Correct representational omissions for actions explicitly requested by the user. */
export function normalizeLocalScope(request: ScopeRequest, response: ScopeResponse): ScopeResponse {
  const categories = [...response.proposal.categories];
  const instruction = request.instruction;
  const prohibitsEntry =
    /\b(?:do not|don't|never|without)\s+(?:type|typing|fill|filling|enter|entering|edit|editing|change|changing)\b/i.test(
      instruction,
    );
  const asksEntry =
    /\b(?:search|find|look up|fill|type|enter|compose|draft)\b/i.test(instruction) ||
    /\b(?:replace|change|update|correct|edit)\b.+\b(?:form|field|input|email address|name)\b/i.test(
      instruction,
    );
  if (asksEntry && !prohibitsEntry && !categories.includes('fill')) categories.push('fill');
  const current = request.tabs.find((tab) => tab.tabId === request.originTabId);
  const currentLabels = new Set([
    'this/current page',
    'current page',
    'this page',
    'current tab',
    'this tab',
    'current website',
    'this website',
    'current site',
    'this site',
  ]);
  const originOf = (value: string) => {
    const url = new URL(
      currentLabels.has(value.trim().toLowerCase()) && current ? current.url : value,
    );
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('The local planner returned an unsupported website scope.');
    return url.origin;
  };
  // Resolve only explicit current-page labels against the actual bound tab.
  // Origin scopes are scheme+host+port, never a page path returned by the model.
  const origins =
    response.proposal.origins === 'browse_web'
      ? 'browse_web'
      : [...new Set(response.proposal.origins.map(originOf))];
  return {
    ...response,
    requestId: request.requestId,
    proposal: { ...response.proposal, categories, origins },
  };
}
