import type { ScopeRequest, ScopeResponse } from '@nudge/contracts';

/** Only explicit, current-form entry. Consequential or cross-page work stays with the planner. */
export function isRoutineFormInstruction(instruction: string): boolean {
  const text = instruction.trim().replace(/^(?:(?:please|can you|could you)\s+)+/i, '');
  if (
    !/^(?:fill|complete|replace|change|update|correct|edit|create (?:a )?draft)\b/i.test(text) ||
    !/\b(?:form|field|input|email address)\b/i.test(text)
  )
    return false;
  const affirmative = text.replace(
    /\b(?:do not|don't|never)\s+(?:submit|send|save|buy|purchase|delete)\b/gi,
    '',
  );
  return !/\b(?:submit|send|save|buy|purchase|delete|archive|move|open|navigate|another|other tab|collect|export|upload|password|payment|login|sign in)\b/i.test(
    affirmative,
  );
}
export function routineFormScope(request: ScopeRequest): ScopeResponse | undefined {
  if (!isRoutineFormInstruction(request.instruction)) return;
  const origin = request.tabs.find((tab) => tab.tabId === request.originTabId);
  if (!origin) return;
  let url: URL;
  try {
    url = new URL(origin.url);
  } catch {
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return;
  return {
    requestId: request.requestId,
    goal: request.instruction,
    proposal: {
      origins: [url.origin],
      categories: ['read', 'navigate', 'fill', 'edit'],
      destinations: [],
      exclusions: [],
      limits: {},
    },
  };
}
