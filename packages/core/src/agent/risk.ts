import type { ActionCategory, ToolCall } from '@nudge/contracts';

export interface RiskTarget {
  kind?: string;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  inputType?: string;
  autocomplete?: string;
  formHasSensitiveField?: boolean;
}

export interface RiskAssessment {
  category: ActionCategory;
  consequential: boolean;
  blocked?: string;
}

const PATTERNS: Array<[RegExp, ActionCategory, boolean]> = [
  [/\b(pay|purchase|buy( now)?|checkout|check out|place (your )?order|complete (purchase|order)|transfer (money|funds)|send money)\b/i, 'purchase', true],
  [/\b(delete forever|permanently delete|delete permanently|empty trash|erase)\b/i, 'delete_permanent', true],
  [/\b(send|reply( all)?|forward|post|publish|tweet)\b/i, 'send_message', true],
  [/\b(trash|delete|remove|archive|move to|discard)\b/i, 'move_reversible', false],
  [/\b(unsubscribe|deactivate|close account|cancel subscription)\b/i, 'edit', true],
  [/\b(submit|sign up|register|apply|confirm|book|enroll)\b/i, 'submit_form', true],
];

const AUTH_CHALLENGE = /\b(captcha|i'?m not a robot|verify you are human|human verification)\b/i;

function isSensitiveField(target: RiskTarget | undefined): boolean {
  if (!target) return false;
  const inputType = target.inputType?.toLowerCase();
  const autocomplete = target.autocomplete?.toLowerCase();
  const label = `${target.name ?? ''} ${target.label ?? ''}`;
  return (
    inputType === 'password' ||
    Boolean(autocomplete?.startsWith('cc-')) ||
    autocomplete === 'current-password' ||
    autocomplete === 'new-password' ||
    /\b(card number|cvc|cvv|security code|expiry|expiration)\b/i.test(label) ||
    (target.formHasSensitiveField === true && /\b(card|cvc|cvv)\b/i.test(label))
  );
}

function describe(target: RiskTarget | undefined): string {
  return [target?.name, target?.text, target?.label].filter(Boolean).join(' ').slice(0, 300);
}

export function classifyRisk(target: RiskTarget | undefined, call: ToolCall): RiskAssessment {
  switch (call.tool) {
    case 'list_tabs':
    case 'observe_tab':
    case 'read_text':
    case 'inspect_element':
    case 'wait_for':
    case 'hover':
    case 'focus':
    case 'scroll':
      return { category: 'read', consequential: false };
    case 'open_tab':
    case 'activate_tab':
    case 'navigate':
    case 'go_back':
    case 'go_forward':
    case 'reload':
    case 'close_tab':
      return { category: 'navigate', consequential: false };
    case 'record_items':
    case 'export_records':
      return { category: 'create_records', consequential: false };
    case 'transfer_code':
      return { category: 'transfer_code', consequential: false };
    case 'start_timed_repeat':
      return { category: 'read', consequential: false };
    case 'ask_user':
    case 'request_confirmation':
    case 'finish':
    case 'report_partial':
      return { category: 'read', consequential: false };
    case 'type_text':
    case 'type_at':
    case 'select_option':
      if (isSensitiveField(target)) {
        return { category: 'fill', consequential: true, blocked: 'Password and payment fields are user-only.' };
      }
      return { category: 'fill', consequential: false };
    case 'press_keys': {
      if (isSensitiveField(target)) {
        return { category: 'fill', consequential: true, blocked: 'Password and payment fields are user-only.' };
      }
      if (call.keys.includes('Enter') && target?.formHasSensitiveField) {
        return { category: 'submit_form', consequential: true };
      }
      return { category: 'fill', consequential: false };
    }
    case 'drag':
    case 'drag_at':
      return { category: 'edit', consequential: false };
    case 'click':
    case 'double_click':
    case 'click_at':
    case 'double_click_at': {
      const text = describe(target);
      if (AUTH_CHALLENGE.test(text)) {
        return { category: 'auth_challenge', consequential: true, blocked: 'Human-verification challenges are handed to you.' };
      }
      for (const [pattern, category, consequential] of PATTERNS) {
        if (pattern.test(text)) {
          return category === 'purchase'
            ? { category, consequential: true, blocked: 'Purchases and money transfers are never performed by Nudge.' }
            : { category, consequential };
        }
      }
      if (target?.formHasSensitiveField && (target.inputType === 'submit' || target.kind === 'button')) {
        return { category: 'submit_form', consequential: true };
      }
      return { category: 'navigate', consequential: false };
    }
  }
}
