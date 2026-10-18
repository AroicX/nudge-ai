import type {
  PlannerRequest,
  PlannerResponse,
  ScopeRequest,
  ScopeResponse,
} from '@nudge/contracts';

import { directDestination } from '@nudge/core';
export { directDestination } from '@nudge/core';

export function directNavigationScope(request: ScopeRequest): ScopeResponse | undefined {
  const url = directDestination(request.instruction);
  if (!url) return;
  return {
    requestId: request.requestId,
    goal: request.instruction,
    proposal: {
      origins: [new URL(url).origin],
      categories: ['read', 'navigate'],
      destinations: [],
      exclusions: [],
      limits: {},
    },
  };
}
export function directNavigationPlan(request: PlannerRequest): PlannerResponse | undefined {
  if (request.memory.constraints.length || !request.observation) return;
  const destination = directDestination(request.authorization.instruction);
  if (!destination) return;
  const current = new URL(request.observation.snapshot.url);
  const target = new URL(destination);
  const matches =
    current.protocol === target.protocol &&
    current.hostname.replace(/^www\./, '') === target.hostname.replace(/^www\./, '') &&
    current.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '') &&
    current.search === target.search &&
    current.hash === target.hash;
  return {
    requestId: request.requestId,
    toolCall: matches
      ? { tool: 'finish', summary: `${target.hostname} is open.`, evidence: [current.href] }
      : { tool: 'navigate', tabId: request.observation.tabId, url: destination },
    ...(matches ? {} : { expectation: { kind: 'url_changed' as const } }),
  };
}
