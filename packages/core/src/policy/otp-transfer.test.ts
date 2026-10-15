import { describe, expect, it } from 'vitest';

import { evaluateOtpTransfer } from './otp-transfer';

const action = {
  type: 'sensitive_transfer' as const,
  taskId: 'task-1', destinationTabId: 7, destinationDocumentId: 'doc-1',
  elementId: 'doc-1:1', cancellationGeneration: 2, expectedLength: 6,
};

describe('OTP transfer policy', () => {
  it('requires explicit OTP intent and exact destination bindings', () => {
    expect(evaluateOtpTransfer({ explicitOtpIntent: false, tabId: 7, documentId: 'doc-1', cancellationGeneration: 2 }, action).decision).toBe('block');
    expect(evaluateOtpTransfer({ explicitOtpIntent: true, tabId: 8, documentId: 'doc-1', cancellationGeneration: 2 }, action).decision).toBe('block');
    expect(evaluateOtpTransfer({ explicitOtpIntent: true, tabId: 7, documentId: 'doc-1', cancellationGeneration: 2 }, action)).toEqual({ decision: 'allow' });
  });
});
