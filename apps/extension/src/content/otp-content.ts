const FRESH_MS = 15 * 60_000;
const CODE_WORDS = /(code|otp|one[-\s]?time|verification|passcode|sign[-\s]?in|log[-\s]?in|2fa)/i;
const CONTAINERS = '[data-received-at],article,[role="listitem"],[role="row"],li,tr';

export type OtpExtraction =
  | { status: 'found'; envelopeCode: string }
  | { status: 'ambiguous' | 'none' | 'stale' };

function timestampOf(element: Element): number | undefined {
  const raw =
    element.getAttribute('data-received-at') ??
    element.querySelector('time[datetime]')?.getAttribute('datetime') ??
    undefined;
  if (!raw) return undefined;
  const value = Date.parse(raw);
  return Number.isNaN(value) ? undefined : value;
}

function codesIn(text: string): string[] {
  const codes = new Set<string>();
  for (const match of text.matchAll(/(?<!\d)\d{4,8}(?!\d)/g)) {
    const start = Math.max(0, (match.index ?? 0) - 50);
    const window = text.slice(start, (match.index ?? 0) + match[0].length + 50);
    if (CODE_WORDS.test(window)) codes.add(match[0]);
  }
  return [...codes];
}

/**
 * Runs inside the source tab. Returns the code only to the extension runtime,
 * never into snapshots, logs or model context.
 */
export function extractOtpFromPage(document: Document, service: string, now: number): OtpExtraction {
  const wanted = service.trim().toLowerCase();
  if (!wanted) return { status: 'none' };
  const all = Array.from(document.querySelectorAll(CONTAINERS)).filter(
    (element) => !element.closest('[data-nudge-root]') && (element.textContent ?? '').toLowerCase().includes(wanted),
  );
  // Prefer the innermost containers so a list wrapper does not merge messages.
  const candidates = all.filter((element) => !all.some((other) => other !== element && element.contains(other)));
  const messages = candidates.filter((element) => codesIn(element.textContent ?? '').length > 0);
  if (messages.length === 0) return { status: 'none' };
  const dated = messages
    .map((element, index) => ({ element, index, at: timestampOf(element) }))
    .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.index - b.index);
  const newest = dated[0]!;
  if (newest.at !== undefined && now - newest.at > FRESH_MS) return { status: 'stale' };
  const codes = codesIn(newest.element.textContent ?? '');
  if (codes.length !== 1) return { status: 'ambiguous' };
  return { status: 'found', envelopeCode: codes[0]! };
}

function labelText(input: HTMLInputElement): string {
  return [
    input.getAttribute('aria-label'),
    input.getAttribute('placeholder'),
    input.getAttribute('name'),
    ...Array.from(input.labels ?? []).map((label) => label.textContent),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Enters the code into a verified destination field. Never submits the form. */
export function enterOtp(target: Element, code: string): { ok: boolean; acceptedLength: number } {
  if (!(target instanceof HTMLInputElement) || target.type === 'password' || target.disabled) {
    return { ok: false, acceptedLength: 0 };
  }
  const codeField = target.autocomplete === 'one-time-code' || CODE_WORDS.test(labelText(target));
  if (!codeField) return { ok: false, acceptedLength: 0 };
  target.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(target, code);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  const acceptedLength = target.value.length;
  return { ok: acceptedLength === code.length, acceptedLength };
}
