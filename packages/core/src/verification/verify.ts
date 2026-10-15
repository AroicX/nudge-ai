import type { ActionResult, PageSnapshot } from '@nudge/contracts';

export type OutcomeExpectation =
  | { kind: 'page_contains'; text: string }
  | { kind: 'element_value'; elementId: string; value: string }
  | { kind: 'url_changed'; url: string }
  | { kind: 'element_state'; elementId: string; state: 'checked' | 'selected' | 'visible' };

export interface ProgressState {
  repeatedActionCount: number;
  noProgressCount: number;
}

export interface VerificationResult {
  verified: boolean;
  shouldStop: boolean;
  evidence?: string;
  reason?: string;
}

export function verifyOutcome(
  expectation: OutcomeExpectation,
  _before: PageSnapshot,
  after: PageSnapshot,
  result: ActionResult,
  progress: ProgressState = { repeatedActionCount: 0, noProgressCount: 0 },
): VerificationResult {
  if (!result.ok) return { verified: false, shouldStop: false, reason: result.detail };

  const shouldStop = progress.repeatedActionCount >= 3 || progress.noProgressCount >= 3;
  if (!result.changed && expectation.kind !== 'element_value') {
    return { verified: false, shouldStop, reason: 'The page did not show a relevant change.' };
  }

  let evidence: string | undefined;
  switch (expectation.kind) {
    case 'page_contains':
      if (after.text.some((text) => text.includes(expectation.text)))
        evidence = `Fresh page contains: ${expectation.text}`;
      break;
    case 'element_value': {
      const element = after.elements.find((candidate) => candidate.id === expectation.elementId);
      if (element?.value === expectation.value) evidence = `Read back value: ${expectation.value}`;
      break;
    }
    case 'url_changed':
      if (after.url === expectation.url) evidence = `Current URL: ${after.url}`;
      break;
    case 'element_state': {
      const element = after.elements.find((candidate) => candidate.id === expectation.elementId);
      if (
        element &&
        ((expectation.state === 'checked' && element.checked === true) ||
          (expectation.state === 'selected' && element.selected === true) ||
          (expectation.state === 'visible' && element.visible))
      ) {
        evidence = `${expectation.state} state observed for ${expectation.elementId}`;
      }
      break;
    }
  }

  return evidence
    ? { verified: true, shouldStop: false, evidence }
    : {
        verified: false,
        shouldStop,
        reason: 'Expected outcome was not present in the fresh page state.',
      };
}
