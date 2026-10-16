import type { ScreenshotFrame } from '@nudge/contracts';

export const FRAME_TTL_MS = 30_000;
export const FRAME_MUTATION_TOLERANCE = 5;

export interface FrameCurrentState {
  tabId: number;
  documentId: string;
  url: string;
  scrollX: number;
  scrollY: number;
  cssWidth: number;
  cssHeight: number;
  mutationCounter: number;
}

export function isFrameFresh(
  frame: ScreenshotFrame,
  current: FrameCurrentState,
  now: number,
): { fresh: true } | { fresh: false; reason: string } {
  if (frame.tabId !== current.tabId) return { fresh: false, reason: 'Screenshot belongs to another tab.' };
  if (frame.documentId !== current.documentId) return { fresh: false, reason: 'The page was reloaded since the screenshot.' };
  if (frame.url !== current.url) return { fresh: false, reason: 'The page address changed since the screenshot.' };
  if (frame.viewport.scrollX !== current.scrollX || frame.viewport.scrollY !== current.scrollY) {
    return { fresh: false, reason: 'The page scrolled since the screenshot.' };
  }
  if (frame.viewport.cssWidth !== current.cssWidth || frame.viewport.cssHeight !== current.cssHeight) {
    return { fresh: false, reason: 'The window was resized since the screenshot.' };
  }
  if (current.mutationCounter - frame.mutationCounterAtCapture > FRAME_MUTATION_TOLERANCE) {
    return { fresh: false, reason: 'The page changed since the screenshot.' };
  }
  if (now - frame.capturedAt > FRAME_TTL_MS) return { fresh: false, reason: 'The screenshot is too old.' };
  return { fresh: true };
}
