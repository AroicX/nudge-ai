import type { BrowserAction, TaskState } from '@nudge/contracts';

export type ActionRisk =
  'none' | 'personal_data_submit' | 'account_change' | 'financial_submit' | 'destructive';

export interface PolicyTarget {
  name?: string;
  inputType?: string;
  autocomplete?: string;
  isSubmit?: boolean;
  actionRisk?: ActionRisk;
}

export interface BoundConfirmation {
  fingerprint: string;
  documentId: string;
  cancellationGeneration: number;
}

export interface PolicyContext {
  task: TaskState;
  tabId: number;
  documentId: string;
  observedUrls: string[];
  target?: PolicyTarget;
  confirmation?: BoundConfirmation;
  untrustedPageText?: string;
}

export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'confirm'; reason: string; fingerprint: string }
  | { decision: 'block'; reason: string };

export function actionFingerprint(
  action: BrowserAction,
  documentId: string,
  generation: number,
): string {
  return JSON.stringify({ action, documentId, generation });
}

export function evaluateAction(context: PolicyContext, action: BrowserAction): PolicyDecision {
  if (context.task.status !== 'active') return { decision: 'block', reason: 'Task is not active.' };
  if (context.tabId !== context.task.boundTabId)
    return { decision: 'block', reason: 'Task is bound to another tab.' };
  if (context.documentId !== context.task.boundDocumentId) {
    return { decision: 'block', reason: 'Page document changed; observe again.' };
  }

  if (
    action.type === 'navigate_to_observed_url' &&
    !context.observedUrls.some((observed) => observed === action.url)
  ) {
    return { decision: 'block', reason: 'Destination was not observed on the current page.' };
  }

  if (action.type === 'type_text') {
    const inputType = context.target?.inputType?.toLowerCase();
    const autocomplete = context.target?.autocomplete?.toLowerCase();
    if (
      inputType === 'password' ||
      autocomplete === 'one-time-code' ||
      autocomplete?.startsWith('cc-')
    ) {
      return {
        decision: 'block',
        reason: 'Sensitive credential and payment fields are user-only.',
      };
    }
  }

  const risk = context.target?.actionRisk ?? 'none';
  if (risk === 'financial_submit' || risk === 'destructive') {
    return {
      decision: 'block',
      reason: 'Irreversible and financially binding actions are blocked.',
    };
  }

  if (risk === 'personal_data_submit' || risk === 'account_change') {
    const fingerprint = actionFingerprint(
      action,
      context.documentId,
      context.task.cancellationGeneration,
    );
    const confirmation = context.confirmation;
    if (
      confirmation?.fingerprint === fingerprint &&
      confirmation.documentId === context.documentId &&
      confirmation.cancellationGeneration === context.task.cancellationGeneration
    ) {
      return { decision: 'allow' };
    }
    return { decision: 'confirm', reason: 'This action needs your confirmation.', fingerprint };
  }

  return { decision: 'allow' };
}
