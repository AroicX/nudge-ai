import type { PageElement, PageSnapshot } from '@nudge/contracts';

import { redactText } from '@nudge/core';

import { accessibleName, associatedLabel } from './accessible-name';
import type { ElementRegistry } from './element-registry';

const MAX_ELEMENTS = 250;
const MAX_TEXT = 200;
const SELECTOR =
  'h1,h2,h3,h4,h5,h6,a,button,input,textarea,select,[role],dialog,[contenteditable="true"],[contenteditable=""],canvas,[draggable="true"]';
const SENSITIVE_IN_FORM = 'input[type="password"],[autocomplete^="cc-"]';

export function isSensitiveElement(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false;
  const type = element.type.toLowerCase();
  const autocomplete = element.autocomplete.toLowerCase();
  return type === 'password' || autocomplete === 'one-time-code' || autocomplete.startsWith('cc-');
}

/** Password and one-time-code fields are listed as targets (never with their value); card fields are omitted. */
function isTargetableSensitiveField(element: Element): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    (element.type.toLowerCase() === 'password' || element.autocomplete.toLowerCase() === 'one-time-code')
  );
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
  const role = element.getAttribute('role');
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'canvas') return 'canvas';
  if (tag === 'input' && ['checkbox', 'radio'].includes((element as HTMLInputElement).type)) return 'checkbox';
  if (role === 'checkbox' || role === 'radio' || role === 'switch') return 'checkbox';
  if (role === 'gridcell' || role === 'cell') return 'gridcell';
  if (role === 'menuitem' || role === 'option') return role === 'option' ? 'option' : 'menuitem';
  if (role === 'tab') return 'tab';
  if (role === 'button') return 'button';
  if (role === 'link') return 'link';
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') return 'input';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'dialog' || role === 'dialog') return 'dialog';
  if ((element as HTMLElement).isContentEditable || element.getAttribute('contenteditable') === 'true') return 'editable';
  return 'text';
}

function isScrollable(element: Element, window: Window): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return /(auto|scroll)/.test(`${style.overflowY} ${style.overflowX}`) && element.scrollHeight > element.clientHeight;
}

const clean = (value: string, max: number) => redactText(value).slice(0, max);

function toPageElement(element: Element, id: string, document: Document, window: Window): PageElement {
  const rect = element.getBoundingClientRect();
  const name = accessibleName(element, document);
  const text = element.textContent?.trim();
  const editable = element instanceof HTMLElement && (element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('contenteditable') === '');
  const form = element.closest('form');
  const expanded = element.getAttribute('aria-expanded');
  const pressed = element.getAttribute('aria-pressed');
  const ariaChecked = element.getAttribute('aria-checked');
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
    ...(name ? { name: clean(name, 500) } : {}),
    ...(text ? { text: clean(text, 1_000) } : {}),
    ...(element instanceof HTMLAnchorElement && element.href ? { href: element.href } : {}),
    ...(associatedLabel(element) ? { label: associatedLabel(element) } : {}),
    ...(element instanceof HTMLInputElement ? { inputType: element.type } : {}),
    ...(field && !isSensitiveElement(field) ? { value: field.value.slice(0, 2_000) } : {}),
    ...(element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
      ? { checked: element.checked }
      : ariaChecked !== null
        ? { checked: ariaChecked === 'true' }
        : {}),
    ...(editable ? { contentEditable: true } : {}),
    ...(expanded !== null ? { expanded: expanded === 'true' } : {}),
    ...(pressed !== null ? { pressed: pressed === 'true' } : {}),
    ...(isScrollable(element, window) ? { scrollable: true } : {}),
    ...(form?.querySelector(SENSITIVE_IN_FORM) ? { formHasSensitiveField: true } : {}),
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

function prioritiseByViewport(elements: Element[], window: Window): Element[] {
  if (elements.length <= MAX_ELEMENTS) return elements;
  const distance = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= window.innerHeight) return 0;
    return rect.top < 0 ? -rect.bottom : rect.top - window.innerHeight;
  };
  const chosen = new Set(
    elements
      .map((element, index) => ({ element, index, distance: distance(element) }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, MAX_ELEMENTS)
      .map((entry) => entry.element),
  );
  return elements.filter((element) => chosen.has(element));
}

export function captureSnapshot(
  document: Document,
  window: Window,
  documentId: string,
  registry: ElementRegistry,
  mutationCounter = 0,
): PageSnapshot {
  const visibleCandidates = Array.from(document.querySelectorAll(SELECTOR)).filter(
    (element) =>
      !element.closest('[data-nudge-root]') &&
      (!isSensitiveElement(element) || isTargetableSensitiveField(element)) &&
      isVisible(element, window),
  );
  const truncated = visibleCandidates.length > MAX_ELEMENTS;
  const elements = prioritiseByViewport(visibleCandidates, window).map((element) =>
    toPageElement(element, registry.register(element), document, window),
  );
  const text = Array.from(document.querySelectorAll('p,li,main,article,section'))
    .filter(
      (element) =>
        !element.closest('[data-nudge-root]') &&
        !element.querySelector(
          'input[type="password"],[autocomplete="one-time-code"],[autocomplete^="cc-"]',
        ) &&
        isVisible(element, window),
    )
    .map((element) => clean(element.textContent?.trim() ?? '', 2_000))
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
    mutationCounter,
    inaccessible: [
      ...(Array.from(document.querySelectorAll('iframe')).some((frame) => {
        try {
          return !frame.contentDocument;
        } catch {
          return true;
        }
      })
        ? (['cross_origin_frame'] as const)
        : []),
      ...(elements.some((element) => element.kind === 'canvas') ? (['canvas'] as const) : []),
    ],
  };
}
