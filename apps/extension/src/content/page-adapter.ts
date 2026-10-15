import type { ActionResult, BrowserAction, PageSnapshot } from '@nudge/contracts';

import { waitForDocumentChange, type ChangeResult } from './change-observer';
import { ElementRegistry } from './element-registry';
import { executeAction, type ExecutionGuard } from './executor';
import { captureSnapshot } from './snapshot';

export interface PageAdapterOptions {
  document: Document;
  window: Window;
  documentId: string;
  navigate?: (url: string) => void;
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
}

export function createPageAdapter(options: PageAdapterOptions): PageAdapter {
  const registry = new ElementRegistry(options.documentId);
  const navigate = options.navigate ?? ((url: string) => options.window.location.assign(url));
  return {
    async observe() {
      return captureSnapshot(options.document, options.window, options.documentId, registry);
    },
    async execute(action, guard) {
      return executeAction({ ...options, registry, navigate }, action, guard);
    },
    async waitForChange(baseline, waitOptions) {
      return waitForDocumentChange(
        options.document,
        options.window,
        baseline,
        waitOptions.timeoutMs,
      );
    },
  };
}
