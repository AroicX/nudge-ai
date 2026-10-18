import type { ProviderSelection } from '@nudge/contracts';
import { isConversationRequest } from '../panel/message-routing';

export const CHATGPT_VOICE_NOTE =
  'Voice calls and dictation still use separately billed OpenAI API requests. They do not use your ChatGPT plan.';

export const CHATGPT_PRIVACY = [
  'Eligible text requests use your connected ChatGPT plan’s allowance.',
  'OpenAI API mode is billed separately and is not used unless you choose it.',
  'Voice may still require API billing.',
  'Connecting does not import ChatGPT history or memory.',
  'Nudge manages its own conversation context.',
];

export function voiceBilling(selection: ProviderSelection): 'api' | 'local' {
  return selection.provider === 'ollama' ? 'local' : 'api';
}

export type TextRoute =
  | { kind: 'plan'; accountId: string; model: string }
  | { kind: 'conversation'; provider: 'openai' | 'ollama' }
  | { kind: 'browser' }
;

/** ChatGPT plan text never selects the paid API. Browser work uses the local tool loop. */
export function routeEligibleText(input: {
  text: string;
  taskStatus?: string | undefined;
  selection: ProviderSelection;
}): TextRoute {
  const conversation = isConversationRequest(input.text, input.taskStatus);
  if (input.selection.provider === 'chatgpt') {
    return conversation
      ? { kind: 'plan', accountId: input.selection.accountId, model: input.selection.model }
      : { kind: 'browser' };
  }
  return conversation
    ? { kind: 'conversation', provider: input.selection.provider }
    : { kind: 'browser' };
}

export function planMessages(input: {
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  question: string;
  boundAccountId?: string;
  activeAccountId: string;
}): { ok: true; messages: Array<{ role: 'user' | 'assistant'; content: string }> } | { ok: false; message: string } {
  if (input.boundAccountId && input.boundAccountId !== input.activeAccountId) {
    return {
      ok: false,
      message:
        'This chat belongs to a different ChatGPT account. Start a new chat so credentials and conversation stay separate.',
    };
  }
  const prior = input.history
    .filter((turn) => turn.text.trim())
    .slice(-6)
    .map((turn) => ({ role: turn.role, content: turn.text.slice(0, 1500) }));
  return { ok: true, messages: [...prior, { role: 'user', content: input.question.slice(0, 4000) }] };
}
