import type { Expectation, PageSnapshot } from '@nudge/contracts';

export interface ExpectationResult {
  verified: boolean;
  evidence?: string;
  reason?: string;
}

const haystack = (snapshot: PageSnapshot) =>
  [
    ...snapshot.text,
    ...snapshot.elements.flatMap((element) => [element.text, element.name, element.value, element.label]),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLowerCase();

export function checkExpectation(
  expectation: Expectation,
  before: PageSnapshot | undefined,
  after: PageSnapshot,
  result: { ok: boolean; changed: boolean; detail: string },
): ExpectationResult {
  if (!result.ok) return { verified: false, reason: result.detail || 'The action failed.' };
  switch (expectation.kind) {
    case 'text_present': {
      const needle = expectation.text.toLowerCase();
      return haystack(after).includes(needle)
        ? { verified: true, evidence: `Page now shows “${expectation.text}”.` }
        : { verified: false, reason: `“${expectation.text}” did not appear.` };
    }
    case 'text_absent': {
      const needle = expectation.text.toLowerCase();
      return haystack(after).includes(needle)
        ? { verified: false, reason: `“${expectation.text}” is still shown.` }
        : { verified: true, evidence: `“${expectation.text}” is no longer shown.` };
    }
    case 'url_changed':
      return before && before.url !== after.url
        ? { verified: true, evidence: `Now at ${after.url}.` }
        : { verified: false, reason: 'The address did not change.' };
    case 'value_equals': {
      const element = after.elements.find((candidate) => candidate.id === expectation.elementId);
      const value = element?.value ?? element?.text;
      const norm = (text: string | undefined) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (value === expectation.value)
        return { verified: true, evidence: `Read back “${expectation.value}”.` };
      // Sites often reformat phone numbers or casing; digits/words must still match.
      const digits = (text: string | undefined) => (text ?? '').replace(/\D/g, '');
      if (
        value !== undefined &&
        (norm(value) === norm(expectation.value) ||
          (digits(expectation.value).length >= 7 && digits(value) === digits(expectation.value)))
      )
        return { verified: true, evidence: `Read back “${value}” (site formatting).` };
      return {
        verified: false,
        reason:
          element === undefined
            ? 'The field is no longer on the page; observe again.'
            : `The field holds “${(value ?? '').slice(0, 200)}” instead of the expected value.`,
      };
    }
    case 'count_changed': {
      // Compare observed state, not the executor's guess: a click reports changed:false
      // even when it opens a dialog or menu, which is exactly the change we look for.
      if (!before) return { verified: false, reason: 'There was no earlier observation to compare.' };
      if (before.stateHash && after.stateHash && before.stateHash !== after.stateHash) {
        if (after.dialog && after.dialog.name !== before.dialog?.name)
          return { verified: true, evidence: `A dialog opened${after.dialog.name ? `: “${after.dialog.name}”` : ''}.` };
        return { verified: true, evidence: 'The page content changed.' };
      }
      const size = (snapshot: PageSnapshot) => snapshot.elements.length + snapshot.text.length;
      const textChanged = haystack(before) !== haystack(after);
      return size(before) !== size(after) || textChanged || before.url !== after.url
        ? { verified: true, evidence: 'The page content changed.' }
        : { verified: false, reason: 'The page did not visibly change.' };
    }
    case 'none':
      return { verified: false, reason: 'No observable expectation was given.' };
  }
}
