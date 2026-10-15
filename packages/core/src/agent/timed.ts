import type { AuthorizationRecord, ToolCall } from '@nudge/contracts';

type TimedCall = Extract<ToolCall, { tool: 'start_timed_repeat' }>;

const REPEAT_KEYS = new Set(['PageDown', 'ArrowDown', 'Space', 'End']);

export function validateTimedRepeat(
  call: TimedCall,
  ctx: { authorization: AuthorizationRecord; tabOrigin: string },
): { ok: true } | { ok: false; reason: string } {
  if (call.intervalMs < 1_000 || call.intervalMs > 60_000) {
    return { ok: false, reason: 'Repeat interval must be between 1 and 60 seconds.' };
  }
  if (call.maxDurationMs > 1_800_000) return { ok: false, reason: 'Timed actions stop after at most 30 minutes.' };
  if (call.action.kind === 'press_keys' && !call.action.keys.every((key) => REPEAT_KEYS.has(key))) {
    return { ok: false, reason: 'Only scrolling keys can be repeated.' };
  }
  const origins = ctx.authorization.origins;
  if (origins !== 'browse_web') {
    const allowed = origins.some((origin) => {
      try {
        return new URL(origin).origin === ctx.tabOrigin;
      } catch {
        return origin === ctx.tabOrigin;
      }
    });
    if (!allowed) return { ok: false, reason: 'That tab is outside the task’s authorized sites.' };
  }
  return { ok: true };
}
