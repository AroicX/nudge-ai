import type { OperationPreview } from '@nudge/contracts';

export interface Confirmation {
  previewId: string;
  targetFingerprint: string;
  generation: number;
}

/** Stable, order-independent FNV-1a fingerprint of a target set. */
export function targetFingerprint(items: string[]): string {
  const text = [...items].map((item) => item.trim()).sort().join('␞');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${items.length}_${hash.toString(16).padStart(8, '0')}`;
}

export function bindConfirmation(preview: OperationPreview, generation: number): Confirmation {
  return { previewId: preview.previewId, targetFingerprint: preview.targetFingerprint, generation };
}

export function isConfirmationValid(confirmation: Confirmation, currentFingerprint: string, generation: number): boolean {
  return confirmation.targetFingerprint === currentFingerprint && confirmation.generation === generation;
}
