import type { BrowserAction, TaskState } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { actionFingerprint, evaluateAction } from './evaluate-action';

const task: TaskState = {
  id: 'task_1',
  goal: 'Update my profile',
  intent: 'fill_form',
  constraints: [],
  successConditions: ['Fields contain supplied values'],
  missingRequiredInformation: [],
  risk: 'low',
  status: 'active',
  cancellationGeneration: 2,
  verifiedActions: [],
  boundTabId: 4,
  boundDocumentId: 'doc_1',
};

const context = {
  task,
  tabId: 4,
  documentId: 'doc_1',
  observedUrls: ['https://example.test/profile'],
};

describe('evaluateAction', () => {
  it('allows ordinary observed-page reading', () => {
    expect(evaluateAction(context, { type: 'read_page' })).toEqual({ decision: 'allow' });
  });

  it('requires exact confirmation for submitting personal data', () => {
    const action: BrowserAction = { type: 'click', elementId: 'doc_1:7' };
    const target = {
      name: 'Save profile',
      isSubmit: true,
      actionRisk: 'personal_data_submit' as const,
    };

    expect(evaluateAction({ ...context, target }, action)).toMatchObject({
      decision: 'confirm',
      fingerprint: actionFingerprint(action, context.documentId, task.cancellationGeneration),
    });
  });

  it('rejects confirmation after the task generation changes', () => {
    const action: BrowserAction = { type: 'click', elementId: 'doc_1:7' };
    const fingerprint = actionFingerprint(
      action,
      context.documentId,
      task.cancellationGeneration - 1,
    );

    expect(
      evaluateAction(
        {
          ...context,
          target: { name: 'Save profile', isSubmit: true, actionRisk: 'personal_data_submit' },
          confirmation: { fingerprint, documentId: 'doc_1', cancellationGeneration: 1 },
        },
        action,
      ).decision,
    ).toBe('confirm');
  });

  it.each(['password', 'one-time-code', 'cc-number'])(
    'blocks typing into the sensitive %s field',
    (signal) => {
      const action: BrowserAction = {
        type: 'type_text',
        elementId: 'doc_1:9',
        text: 'secret',
        mode: 'replace',
      };

      expect(
        evaluateAction(
          {
            ...context,
            target:
              signal === 'password'
                ? { inputType: 'password' }
                : { inputType: 'text', autocomplete: signal },
          },
          action,
        ).decision,
      ).toBe('block');
    },
  );

  it('blocks navigation to a URL that was not observed', () => {
    expect(
      evaluateAction(context, {
        type: 'navigate_to_observed_url',
        url: 'https://attacker.example/collect',
        sourceElementId: 'doc_1:4',
      }).decision,
    ).toBe('block');
  });

  it('blocks a financial submission even when confirmation is present', () => {
    const action: BrowserAction = { type: 'click', elementId: 'doc_1:11' };
    const fingerprint = actionFingerprint(action, 'doc_1', 2);

    expect(
      evaluateAction(
        {
          ...context,
          target: { name: 'Send transfer', isSubmit: true, actionRisk: 'financial_submit' },
          confirmation: { fingerprint, documentId: 'doc_1', cancellationGeneration: 2 },
        },
        action,
      ).decision,
    ).toBe('block');
  });
});
