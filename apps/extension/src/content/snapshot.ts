import type { PageElement, PageSnapshot } from '@nudge/contracts';

import { accessibleName, associatedLabel } from './accessible-name';
import { ElementRegistry } from './element-registry';

const MAX_ELEMENTS = 250;
const MAX_TEXT = 200;
const SELECTOR =
  'h1,h2,h3,h4,h5,h6,a,button,input,textarea,select,[role],dialog,[contenteditable="true"]';

export function isSensitiveElement(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false;
  const type = element.type.toLowerCase();
  const autocomplete = element.autocomplete.toLowerCase();
  return type === 'password' || autocomplete === 'one-time-code' || autocomplete.startsWith('cc-');
}

export function isVisible(element: Element, window: Window): boolean {
  if (!element.isConnected || element.hasAttribute('hidden')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function kindFor(element: Element): PageElement['kind'] {
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') return 'input';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'dialog' || element.getAttribute('role') === 'dialog') return 'dialog';
  return 'text';
}

function toPageElement(element: Element, id: string, document: Document): PageElement {
  const rect = element.getBoundingClientRect();
  const field =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element
      : undefined;
  return {
    id,
    kind: kindFor(element),
    ...(element.getAttribute('role') ? { role: element.getAttribute('role')! } : {}),
    ...(accessibleName(element, document)
      ? { name: accessibleName(element, document).slice(0, 500) }
      : {}),
    ...(element.textContent?.trim() ? { text: element.textContent.trim().slice(0, 1_000) } : {}),
    ...(element instanceof HTMLAnchorElement && element.href ? { href: element.href } : {}),
    ...(associatedLabel(element) ? { label: associatedLabel(element) } : {}),
    ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}),
    ...(field ? { value: field.value.slice(0, 2_000) } : {}),
    ...(element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
      ? { checked: element.checked }
      : {}),
    ...(element instanceof HTMLSelectElement
      ? {
          options: Array.from(element.options)
            .slice(0, 200)
            .map((option) => option.text),
        }
      : {}),
    visible: true,
    disabled:
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? element.disabled
        : element.getAttribute('aria-disabled') === 'true',
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

export function captureSnapshot(
  document: Document,
  window: Window,
  documentId: string,
  registry: ElementRegistry,
): PageSnapshot {
  const candidates = Array.from(document.querySelectorAll(SELECTOR)).filter(
    (element) =>
      !element.closest('[data-nudge-root]') &&
      !isSensitiveElement(element) &&
      isVisible(element, window),
  );
  const truncated = candidates.length > MAX_ELEMENTS;
  const elements = candidates
    .slice(0, MAX_ELEMENTS)
    .map((element) => toPageElement(element, registry.register(element), document));
  const text = Array.from(document.querySelectorAll('p,li,main,article,section'))
    .filter(
      (element) =>
        !element.closest('[data-nudge-root]') &&
        !element.querySelector(
          'input[type="password"],[autocomplete="one-time-code"],[autocomplete^="cc-"]',
        ) &&
        isVisible(element, window),
    )
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean)
    .slice(0, MAX_TEXT);
  elements.forEach((element) => {
    const value = element.text || element.name;
    if (value && text.length < MAX_TEXT && !text.includes(value)) text.push(value);
  });

  return {
    snapshotId: `snap_${crypto.randomUUID()}`,
    documentId,
    capturedAt: new Date().toISOString(),
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: Math.max(0, window.scrollX),
      scrollY: Math.max(0, window.scrollY),
      pageHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        window.innerHeight,
      ),
    },
    elements,
    text,
    truncated,
    inaccessible: Array.from(document.querySelectorAll('iframe')).some((frame) => {
      try {
        return !frame.contentDocument;
      } catch {
        return true;
      }
    })
      ? ['cross_origin_frame']
      : [],
  };
}
