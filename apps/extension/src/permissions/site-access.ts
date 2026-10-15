export interface PermissionsApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
}

export interface SiteAccessResult {
  granted: boolean;
  originPattern?: string;
  reason?: 'unsupported-page';
}

function originPatternFor(pageUrl: string): string | undefined {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.origin}/*`;
  } catch {
    return undefined;
  }
}

export async function hasSiteAccess(
  pageUrl: string,
  permissions: PermissionsApi = browser.permissions,
): Promise<boolean> {
  const originPattern = originPatternFor(pageUrl);
  return originPattern ? permissions.contains({ origins: [originPattern] }) : false;
}

export async function requestSiteAccess(
  pageUrl: string,
  permissions: PermissionsApi = browser.permissions,
): Promise<SiteAccessResult> {
  const originPattern = originPatternFor(pageUrl);
  if (!originPattern) return { granted: false, reason: 'unsupported-page' };

  const granted = await permissions.request({ origins: [originPattern] });
  return { granted, originPattern };
}
