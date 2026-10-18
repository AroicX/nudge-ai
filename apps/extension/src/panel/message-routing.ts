import { localBrowserInstruction } from '../voice/local-voice';

const CONTINUATION =
  /^(?:please\s+)?(?:try again(?: now)?|retry(?: now)?|continue(?: (?:the task|where (?:i|you|we) left off|from where (?:i|you|we) (?:stopped|left off)))?|resume(?: the task)?|pick up where (?:i|you|we) left off|carry on|keep going)[.!]?$/i;

export function isContinuationRequest(text: string): boolean {
  return CONTINUATION.test(text.trim());
}

/** A finished browser task can be resumed from the same chat. A live task keeps its own controls. */
export function resumeBrowserInstruction(
  text: string,
  previousInstruction: string | undefined,
  taskStatus?: string,
): string | undefined {
  if (!isContinuationRequest(text)) return;
  if (
    taskStatus &&
    !['idle', 'completed', 'partially_completed', 'failed', 'cancelled'].includes(taskStatus)
  )
    return;
  const previous = previousInstruction?.trim();
  if (!previous || isContinuationRequest(previous)) return;
  return `${previous}\nContinue this browser task on the current page from where it stopped. Use saved account documents and profile facts for form fields. Ask only for a detail that is absent from those references.`;
}

export function isConversationRequest(text: string, taskStatus?: string): boolean {
  if (
    taskStatus &&
    !['idle', 'completed', 'partially_completed', 'failed', 'cancelled'].includes(taskStatus)
  )
    return false;
  // An action may need saved personal details; mentioning a CV must not turn it
  // into a conversational reply that cannot operate the form.
  if (
    /^(?:(?:please|can you|could you)\s+)*(?:fill|complete|submit|apply|open|visit|navigate|click|type|enter|send|schedule|book)\b/i.test(
      text.trim(),
    )
  )
    return false;
  if (
    /\b(?:my (?:cv|resume|résumé|profile|acceptance letter)|what (?:did|do) (?:I|you) (?:say|tell|remember)|who am I|remember (?:that|my)|forget (?:that|my))\b/i.test(
      text,
    )
  )
    return true;
  if (
    /\b(?:fill (?:in|out)|submit (?:the |this )?form|calendar|schedule|send (?:an? |the )?(?:email|message)|browse|search the web)\b/i.test(
      text,
    )
  )
    return false;
  return !localBrowserInstruction(text, false);
}
