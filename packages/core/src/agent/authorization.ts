import type { ActionCategory, AuthorizationProposal, AuthorizationRecord } from '@nudge/contracts';

/** Categories that need explicit wording in the user's own instruction. */
const LEXICAL_GATES: Partial<Record<ActionCategory, RegExp>> = {
  delete_permanent: /\b(permanent(ly)?\s+(delete|remove|erase)|delete\s+(forever|permanently)|empty\s+(the\s+)?trash)\b/i,
  move_reversible: /\b(trash|archive|move|delete|remove|clean\s*up|label)\b/i,
  send_message: /\b(send|reply|forward|post|email\s+(him|her|them|back)|message\s+\w+)\b/i,
  submit_form: /\b(submit|apply|sign\s*(me\s+)?up|register|book|enroll|subscribe)\b/i,
  purchase: /\b(buy|purchase|order|checkout|check\s+out|pay)\b/i,
  transfer_code: /\b(code|otp|one[-\s]?time|verification|passcode)\b/i,
  auth_challenge: /$^/, // never granted by wording; always handed to the user
};

const ALWAYS: ActionCategory[] = ['read', 'navigate'];

function allowedByWords(category: ActionCategory, text: string): boolean {
  const gate = LEXICAL_GATES[category];
  return gate ? gate.test(text) : true;
}

export function sanitizeAuthorization(
  proposal: AuthorizationProposal,
  instruction: string,
  taskId: string,
): AuthorizationRecord {
  const categories = new Set<ActionCategory>(ALWAYS);
  for (const category of proposal.categories) {
    if (allowedByWords(category, instruction)) categories.add(category);
  }
  return {
    taskId,
    instruction,
    origins: proposal.origins,
    categories: [...categories],
    destinations: proposal.destinations,
    exclusions: proposal.exclusions,
    limits: proposal.limits,
  };
}

/** Extend scope from new user words only; page content never reaches this function. */
export function extendAuthorization(record: AuthorizationRecord, correctionText: string): AuthorizationRecord {
  const categories = new Set(record.categories);
  for (const category of Object.keys(LEXICAL_GATES) as ActionCategory[]) {
    if (category === 'auth_challenge') continue;
    if (allowedByWords(category, correctionText)) categories.add(category);
  }
  return { ...record, categories: [...categories], instruction: `${record.instruction}\n${correctionText}`.slice(0, 4_000) };
}
