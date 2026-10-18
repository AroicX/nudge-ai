import type { ActionResult, BrowserAction, ContentRequest, ContentResult, PageSnapshot } from '@nudge/contracts';

import { hideCursor, moveCursorTo, showActionCursor } from './action-cursor';
import { waitForDocumentChange, type ChangeResult } from './change-observer';
import { ElementRegistry } from './element-registry';
import { executeAction, type ExecutionGuard } from './executor';
import { enterOtp, extractOtpFromPage } from './otp-content';
import { captureSnapshot } from './snapshot';
import { TimedRepeatRunner, type TimedEndReason } from './timed-repeat';
import { attachFile, executeTool } from './tool-executor';

export interface PageAdapterOptions {
  document: Document;
  window: Window;
  documentId: string;
  navigate?: (url: string) => void;
  visualizeActions?: boolean;
  onTimedEnd?: (repeatId: string, reason: TimedEndReason) => void;
}

export interface ObserveOptions {
  reason?: string;
}

export interface WaitForChangeOptions {
  timeoutMs: number;
}

export interface PageAdapter {
  observe(options?: ObserveOptions): Promise<PageSnapshot>;
  execute(action: BrowserAction, guard: ExecutionGuard): Promise<ActionResult>;
  waitForChange(baseline: string, options: WaitForChangeOptions): Promise<ChangeResult>;
  handle(request: ContentRequest): Promise<ContentResult>;
}

export function createPageAdapter(options: PageAdapterOptions): PageAdapter {
  const { document, window, documentId } = options;
  const registry = new ElementRegistry(documentId);
  const navigate = options.navigate ?? ((url: string) => window.location.assign(url));
  const visualizeTarget = options.visualizeActions
    ? (target: Element) => showActionCursor(document, window, target)
    : undefined;

  let mutations = 0;
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver((records: MutationRecord[]) => {
      if (records.some((record) => !(record.target as Element).closest?.('[data-nudge-root]'))) {
        mutations += 1;
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  const snapshot = () => captureSnapshot(document, window, documentId, registry, mutations);
  const timed = new TimedRepeatRunner({
    scrollBy: (x, y) => window.scrollBy({ left: x, top: y }),
    metrics: () => ({
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      pageHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    }),
    now: () => Date.now(),
    onEnd: (id, reason) => options.onTimedEnd?.(id, reason),
    addUnloadListener: (listener) => {
      window.addEventListener('pagehide', listener);
      return () => window.removeEventListener('pagehide', listener);
    },
    pressKey: (key) =>
      void executeTool(toolDeps, { tool: 'press_keys', tabId: 0, keys: [key] }),
  });

  const toolDeps = {
    document,
    window,
    documentId,
    registry,
    visualizeTarget,
    observeText: () => {
      const current = snapshot();
      return [...current.text, ...current.elements.flatMap((element) => [element.text ?? '', element.name ?? ''])];
    },
    mutationCount: () => mutations,
  };

  const result = (ok: boolean, detail: string, extra: Partial<ContentResult> = {}): ContentResult => ({
    ok,
    detail,
    changed: false,
    documentId,
    ...extra,
  });

  return {
    async observe() {
      return snapshot();
    },
    async execute(action, guard) {
      return executeAction({ ...options, registry, navigate, visualizeTarget }, action, guard);
    },
    async waitForChange(baseline, waitOptions) {
      return waitForDocumentChange(document, window, baseline, waitOptions.timeoutMs);
    },
    async handle(request) {
      switch (request.type) {
        case 'observe':
          return result(true, 'Observed.', { snapshot: snapshot() });
        case 'execute': {
          if (request.documentId !== documentId) return result(false, 'Page document is stale; observe again.');
          const before = mutations;
          const outcome = await executeTool(toolDeps, request.call);
          if (!outcome.ok || ['read_text', 'inspect_element', 'wait_for'].includes(request.call.tool)) return outcome;
          // Give the page a moment to react, then report whether anything changed.
          await new Promise((done) => window.setTimeout(done, 150));
          return { ...outcome, changed: outcome.changed || mutations !== before };
        }
        case 'cursor':
          await moveCursorTo(document, window, request.x, request.y);
          return result(true, 'Cursor moved.');
        case 'cursor_hide':
          hideCursor(document);
          return result(true, 'Cursor hidden.');
        case 'timed_start':
          timed.start(request);
          return result(true, 'Timed repeat started.');
        case 'timed_stop':
          return result(timed.stop(request.repeatId), 'Timed repeat stopped.', { ended: 'stopped' });
        case 'read_text':
          return executeTool(toolDeps, { tool: 'read_text', tabId: 0, ...(request.elementId ? { elementId: request.elementId } : {}) });
        case 'inspect':
          return executeTool(toolDeps, { tool: 'inspect_element', tabId: 0, elementId: request.elementId });
        case 'attach_file': {
          if (request.documentId !== documentId)
            return result(false, 'Page document is stale; observe again.', { errorCategory: 'stale_element' });
          const target = registry.resolve(request.elementId);
          if (!target || !target.isConnected)
            return result(false, 'Element no longer exists; observe again.', { errorCategory: 'stale_element' });
          return attachFile({ document, window, documentId }, target, request.file);
        }
        case 'otp_extract': {
          const extraction = extractOtpFromPage(document, request.service, request.now);
          return result(extraction.status === 'found', `Code lookup: ${extraction.status}.`, { otp: extraction });
        }
        case 'otp_enter': {
          if (request.documentId !== documentId) return result(false, 'Destination page changed.');
          const target = registry.resolve(request.elementId);
          if (!target || !target.isConnected) return result(false, 'Destination field is gone.');
          const entry = enterOtp(target, request.envelopeCode);
          return result(entry.ok, entry.ok ? 'Code entered; not submitted.' : 'The field did not accept the code.', {
            changed: entry.ok,
            otp: { status: entry.ok ? 'found' : 'none', acceptedLength: entry.acceptedLength },
          });
        }
      }
    },
  };
}
