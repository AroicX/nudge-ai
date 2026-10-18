const SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com/',
  google: 'https://www.google.com/',
  github: 'https://github.com/',
  apple: 'https://www.apple.com/',
  gmail: 'https://mail.google.com/',
};
/** Exact navigation only. Ambiguous names and compound requests still need planning. */
export function directDestination(instruction: string): string | undefined {
  const match = instruction
    .trim()
    .match(
      /^(?:(?:sure|okay|ok|yes)[,!]?\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:open|visit|go to|navigate to|take me to)\s+(.+?)[.!?]?$/i,
    );
  const target = match?.[1]?.trim().replace(/\s+now$/i, '').replace(/\s+in (?:this|the current|the same) tab$/i, '');
  if (!target) return;
  if (Object.hasOwn(SITES, target.toLowerCase())) return SITES[target.toLowerCase()];
  if (/\s/.test(target) || !/^(?:https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/|$))/i.test(target))
    return;
  try {
    const url = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    /* Unknown destination stays with the planner. */
  }
}
