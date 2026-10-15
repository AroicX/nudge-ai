import type { SensitiveTransferAction } from '@nudge/contracts';

export interface OtpTransferContext {
  explicitOtpIntent: boolean;
  tabId: number;
  documentId: string;
  cancellationGeneration: number;
}

export function evaluateOtpTransfer(context: OtpTransferContext, action: SensitiveTransferAction) {
  if (!context.explicitOtpIntent) return { decision: 'block' as const, reason: 'OTP transfer was not explicitly requested.' };
  if (context.tabId !== action.destinationTabId) return { decision: 'block' as const, reason: 'OTP destination tab changed.' };
  if (context.documentId !== action.destinationDocumentId) return { decision: 'block' as const, reason: 'OTP destination document changed.' };
  if (context.cancellationGeneration !== action.cancellationGeneration) return { decision: 'block' as const, reason: 'OTP transfer was cancelled.' };
  return { decision: 'allow' as const };
}
