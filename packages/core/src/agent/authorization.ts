import type { ActionCategory, AuthorizationProposal, AuthorizationRecord } from '@nudge/contracts';

/** Categories that need explicit wording in the user's own instruction. */
const LEXICAL_GATES: Partial<Record<ActionCategory, RegExp>> = {
  delete_permanent:
    /\b(permanent(ly)?\s+(delete|remove|erase)|delete\s+(forever|permanently)|empty\s+(the\s+)?trash)\b/i,
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

/** Extract affirmative user commands, not quoted content, reported page instructions or prohibitions. */
function clarificationCommands(text: string): string[] {
  const unquoted = text.replace(/```[\s\S]*?```|"[^"\n]*"|“[^”\n]*”/g, '');
  const prefix =
    /^(?:yes[,\s]+|please\s+|also\s+|then\s+|now\s+|actually[,\s]+|go ahead and\s+|you (?:can|may|should)\s+|(?:can|could|would) you\s+|i (?:want|need) you to\s+|i(?:'d| would) like you to\s+)/i;
  return unquoted.split(/[;.!?\n]+/).flatMap((sentence) => {
    const commands: string[] = [];
    let imperative = sentence.trim();
    while (prefix.test(imperative)) imperative = imperative.replace(prefix, '').trim();
    // Do not promote a reported instruction's coordinated verbs into user commands.
    if (
      !/^(?:fill|type|enter|search|find|look up|draft|compose|write|edit|rewrite|revise|change|update|replace|correct|collect|gather|record|export|create|save|copy|add|append|permanently?|delete|remove|erase|empty|trash|archive|move|clean|label|send|reply|forward|post|email|message|submit|apply|sign|register|book|enroll|subscribe|buy|purchase|order|checkout|check|pay|transfer|paste|use)\b/i.test(
        imperative,
      )
    )
      return [];
    for (const part of imperative.split(/\s+(?:and(?: then| also)?|but)\s+/i)) {
      let command = part.trim();
      while (prefix.test(command)) command = command.replace(prefix, '').trim();
      // A prohibition also covers its coordinated verbs: "do not fill and submit".
      if (/^(?:do not|don't|don’t|never|avoid|without|stop)\b/i.test(command)) break;
      if (command) commands.push(command);
    }
    return commands;
  });
}

/** Extend scope from explicit new user commands only; page content never reaches this function. */
export function extendAuthorization(
  record: AuthorizationRecord,
  correctionText: string,
): AuthorizationRecord {
  const categories = new Set(record.categories);
  const commands = clarificationCommands(correctionText);
  for (const command of commands) {
    if (
      /^(?:fill|type(?! of\b)|enter|search|find|look up|draft|compose|write)\b/i.test(command) &&
      !/\bwithout (?:typing|filling|entering)\b/i.test(command)
    )
      categories.add('fill');
    if (
      /^(?:edit|rewrite|revise)\b/i.test(command) ||
      /^(?:change|update|replace|correct)\s+(?:(?:the|this|my)\s+)?(?:text|content|draft|field|form|paragraph|description|title|name|email|address|phone|row|cell|document)\b/i.test(
        command,
      )
    ) {
      categories.add('edit');
      categories.add('fill');
    }
    if (
      /^(?:collect|gather|record|export)\b/i.test(command) ||
      /^create\s+(?:(?:a|the|new)\s+)*(?:table|spreadsheet|sheet|records|list)\b/i.test(command) ||
      /^(?:save|copy|add|append|write)\b.*\b(?:records|results|rows|spreadsheet|sheet|table|csv|xlsx)\b/i.test(
        command,
      )
    )
      categories.add('create_records');
    for (const [category, pattern] of Object.entries(LEXICAL_GATES) as Array<
      [ActionCategory, RegExp]
    >) {
      if (category === 'auth_challenge' || category === 'transfer_code') continue;
      // A draft mentioning "send" is not a command to send it.
      if (new RegExp(`^(?:${pattern.source})`, 'i').test(command)) categories.add(category);
    }
    if (
      /^(?:copy|transfer|enter|paste|use)\b.*\b(?:code|otp|one[-\s]?time|verification|passcode)\b/i.test(
        command,
      )
    )
      categories.add('transfer_code');
  }
  return {
    ...record,
    categories: [...categories],
    instruction: `${record.instruction}\n${correctionText}`.slice(0, 4_000),
  };
}
