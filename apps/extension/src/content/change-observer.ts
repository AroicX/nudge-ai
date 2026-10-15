export interface ChangeResult {
  changed: boolean;
  reason: 'mutation' | 'url' | 'timeout';
}

export function waitForDocumentChange(
  document: Document,
  window: Window,
  baselineUrl: string,
  timeoutMs: number,
): Promise<ChangeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ChangeResult) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(result);
    };
    const observer = new MutationObserver(() => finish({ changed: true, reason: 'mutation' }));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const timeout = window.setTimeout(() => {
      finish(
        window.location.href !== baselineUrl
          ? { changed: true, reason: 'url' }
          : { changed: false, reason: 'timeout' },
      );
    }, timeoutMs);
  });
}
