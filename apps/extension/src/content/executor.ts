import type { ActionResult, BrowserAction } from '@nudge/contracts';

import { ElementRegistry } from './element-registry';
import { isVisible } from './snapshot';

export interface ExecutionGuard {
  active: boolean;
  documentId: string;
}

interface ExecutorDependencies {
  document: Document;
  window: Window;
  documentId: string;
  registry: ElementRegistry;
  navigate(url: string): void;
  visualizeTarget?: ((target: Element) => Promise<void>) | undefined;
}

function failure(action: BrowserAction, documentId: string, detail: string): ActionResult {
  return { ok: false, actionType: action.type, documentId, changed: false, detail };
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Native value setter is unavailable.');
  setter.call(element, value);
}

export async function executeAction(
  dependencies: ExecutorDependencies,
  action: BrowserAction,
  guard: ExecutionGuard,
): Promise<ActionResult> {
  const { documentId, registry, window } = dependencies;
  if (!guard.active) return failure(action, documentId, 'Task is no longer active.');
  if (guard.documentId !== documentId)
    return failure(action, documentId, 'Page document is stale.');

  if (action.type === 'read_page' || action.type === 'wait_for_change') {
    return {
      ok: true,
      actionType: action.type,
      documentId,
      changed: false,
      detail: 'Observation action accepted.',
    };
  }
  if (action.type === 'scroll') {
    const sign = action.direction === 'up' || action.direction === 'left' ? -1 : 1;
    const amount = action.amount === 'viewport' ? window.innerHeight * 0.8 : action.amount;
    window.scrollBy({
      left: action.direction === 'left' || action.direction === 'right' ? sign * amount : 0,
      top: action.direction === 'up' || action.direction === 'down' ? sign * amount : 0,
      behavior: 'smooth',
    });
    return {
      ok: true,
      actionType: action.type,
      documentId,
      changed: true,
      detail: 'Viewport scrolled.',
    };
  }

  const elementId =
    action.type === 'navigate_to_observed_url' ? action.sourceElementId : action.elementId;
  if (!registry.belongsToDocument(elementId))
    return failure(action, documentId, 'Element reference is stale.');
  const target = registry.resolve(elementId);
  if (!target || !target.isConnected)
    return failure(action, documentId, 'Element no longer exists.');
  if (!isVisible(target, window)) return failure(action, documentId, 'Element is not visible.');
  if (
    (target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement) &&
    target.disabled
  ) {
    return failure(action, documentId, 'Element is disabled.');
  }

  await dependencies.visualizeTarget?.(target);

  if (action.type === 'click') {
    (target as HTMLElement).click();
    return {
      ok: true,
      actionType: action.type,
      documentId,
      changed: false,
      detail: 'Click dispatched.',
    };
  }
  if (action.type === 'type_text') {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return failure(action, documentId, 'Target is not a text field.');
    }
    const value = action.mode === 'append' ? `${target.value}${action.text}` : action.text;
    setNativeValue(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      ok: target.value === value,
      actionType: action.type,
      documentId,
      changed: target.value === value,
      detail: target.value === value ? 'Text value verified.' : 'Website rejected the text value.',
    };
  }
  if (action.type === 'select_option') {
    if (!(target instanceof HTMLSelectElement))
      return failure(action, documentId, 'Target is not a select control.');
    const hasOption = Array.from(target.options).some(
      (option) => option.value === action.value || option.text === action.value,
    );
    if (!hasOption) return failure(action, documentId, 'Requested option is not available.');
    target.value = action.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      ok: true,
      actionType: action.type,
      documentId,
      changed: true,
      detail: 'Selection verified.',
    };
  }
  if (action.type === 'navigate_to_observed_url') {
    if (!(target instanceof HTMLAnchorElement) || target.href !== action.url) {
      return failure(action, documentId, 'Destination was not observed on the referenced link.');
    }
    dependencies.navigate(action.url);
    return {
      ok: true,
      actionType: action.type,
      documentId,
      changed: true,
      detail: 'Observed destination opened.',
    };
  }

  return failure(action, documentId, 'Unsupported action.');
}
