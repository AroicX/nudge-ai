import type { AuthorizationRecord } from '@nudge/contracts';

export interface NavigationContext {
  userTypedUrls: string[];
  observedUrls: string[];
  taskOrigins: string[];
  recordValues: string[];
  authorization: AuthorizationRecord;
}

export type NavigationOutcome = { ok: true } | { ok: false; reason: string } | { ok: 'confirm'; reason: string };

function originOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

export function validateNavigation(url: string, ctx: NavigationContext): NavigationOutcome {
  const origin = originOf(url);
  if (!origin) return { ok: false, reason: 'Only HTTP(S) addresses can be opened.' };
  const knownOrigins = new Set(ctx.taskOrigins.map(originOf).filter(Boolean));
  const newOrigin = !knownOrigins.has(origin);

  if (newOrigin) {
    const decoded = (() => {
      try {
        return decodeURIComponent(new URL(url).search + new URL(url).pathname).toLowerCase();
      } catch {
        return '';
      }
    })();
    const leaked = ctx.recordValues.find((value) => value.length >= 4 && decoded.includes(value.toLowerCase()));
    if (leaked) {
      return { ok: 'confirm', reason: `This address would send collected information to ${new URL(url).hostname}.` };
    }
  }

  if (ctx.userTypedUrls.some((typed) => sameUrl(typed, url))) return { ok: true };
  if (ctx.observedUrls.some((observed) => sameUrl(observed, url))) return { ok: true };
  if (!newOrigin) return { ok: true };
  const origins = ctx.authorization.origins;
  if (origins === 'browse_web') return { ok: true };
  if (origins.some((allowed) => originOf(allowed) === origin || allowed === new URL(url).hostname)) return { ok: true };
  return { ok: false, reason: `${new URL(url).hostname} is outside what you asked me to use.` };
}
