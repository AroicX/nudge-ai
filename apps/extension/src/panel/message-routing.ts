import { localBrowserInstruction } from '../voice/local-voice';

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
