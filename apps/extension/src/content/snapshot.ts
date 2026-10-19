import { contentRandomUUID } from './random-id';
import type { PageElement, PageSnapshot } from '@nudge/contracts';

import { redactText, stableHash } from '@nudge/core';

import { accessibleName, associatedLabel } from './accessible-name';
import type { ElementRegistry } from './element-registry';

const MAX_ELEMENTS = 250;
const MAX_TEXT = 200;
// Structural roles add noise (Calendar renders thousands); they are not targets.
const IGNORED_ROLES = new Set([
  'presentation',
  'none',
  'generic',
  'rowgroup',
  'region',
  'main',
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'document',
  'application',
  'separator',
  'log',
  'status',
  'timer',
  'marquee',
  'tooltip',
]);
const SELECTOR =
  'h1,h2,h3,h4,h5,h6,a,button,input,textarea,select,[role],dialog,[contenteditable="true"],[contenteditable=""],canvas,[draggable="true"],[aria-haspopup]';
const DIALOGS = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
const FORM_CONTROL =
  'input,textarea,select,[role="combobox"],[role="textbox"],[role="searchbox"],[role="listbox"],[role="radio"],[role="checkbox"],[role="switch"],[role="spinbutton"],[role="option"],[contenteditable="true"],[contenteditable=""]';
const SENSITIVE_IN_FORM = 'input[type="password"],[autocomplete^="cc-"]';
const MAX_FRAMES = 10;

export function isSensitiveElement(element: Element): boolean {
  if (!(element instanceof (element.ownerDocument?.defaultView?.HTMLInputElement ?? HTMLInputElement)))
    return false;
  const input = element as HTMLInputElement;
  const type = input.type.toLowerCase();
  const autocomplete = input.autocomplete.toLowerCase();
  return type === 'password' || autocomplete === 'one-time-code' || autocomplete.startsWith('cc-');
}

/** Password and one-time-code fields are listed as targets (never with their value); card fields are omitted. */
function isTargetableSensitiveField(element: Element): boolean {
  const input = element as HTMLInputElement;
  return (
    isInput(element) &&
    (input.type.toLowerCase() === 'password' || input.autocomplete.toLowerCase() === 'one-time-code')
  );
}

const viewOf = (element: Element, fallback: Window): Window =>
  (element.ownerDocument?.defaultView as Window | null) ?? fallback;

// Frames have their own constructors, so `instanceof` checks use tag names.
const tag = (element: Element) => element.tagName.toLowerCase();
const isInput = (element: Element): element is HTMLInputElement => tag(element) === 'input';
const isTextArea = (element: Element): element is HTMLTextAreaElement => tag(element) === 'textarea';
const isSelect = (element: Element): element is HTMLSelectElement => tag(element) === 'select';

export function isVisible(element: Element, window: Window): boolean {
  if (!element.isConnected || element.hasAttribute('hidden')) return false;
  const style = viewOf(element, window).getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function kindFor(element: Element): PageElement['kind'] {
  const name = tag(element);
  const role = element.getAttribute('role');
  if (/^h[1-6]$/.test(name) || role === 'heading') return 'heading';
  if (name === 'canvas') return 'canvas';
  if (name === 'input' && (element as HTMLInputElement).type === 'file') return 'file';
  if (name === 'input' && ['checkbox', 'radio'].includes((element as HTMLInputElement).type)) return 'checkbox';
  if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio')
    return 'checkbox';
  if (role === 'combobox' || (name === 'input' && (element.hasAttribute('list') || element.getAttribute('aria-autocomplete'))))
    return 'combobox';
  if (role === 'listbox') return 'listbox';
  if (role === 'gridcell' || role === 'cell') return 'gridcell';
  if (role === 'menuitem' || role === 'option' || role === 'treeitem') return role === 'option' ? 'option' : 'menuitem';
  if (role === 'tab') return 'tab';
  if (role === 'dialog' || role === 'alertdialog' || name === 'dialog') return 'dialog';
  if (role === 'button') return 'button';
  if (role === 'link') return 'link';
  if (name === 'a') return 'link';
  if (name === 'button') return 'button';
  if (name === 'input') return 'input';
  if (name === 'textarea') return 'textarea';
  if (name === 'select') return 'select';
  if ((element as HTMLElement).isContentEditable || element.getAttribute('contenteditable') === 'true') return 'editable';
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') return 'input';
  return 'text';
}

function isScrollable(element: Element, window: Window): boolean {
  if (!(element as HTMLElement).style) return false;
  const style = viewOf(element, window).getComputedStyle(element);
  return /(auto|scroll)/.test(`${style.overflowY} ${style.overflowX}`) && element.scrollHeight > element.clientHeight;
}

const clean = (value: string, max: number) => redactText(value).replace(/\s+/g, ' ').trim().slice(0, max);

function idText(element: Element, ids: string | null): string {
  if (!ids) return '';
  const root = element.getRootNode() as Document | ShadowRoot;
  return ids
    .split(/\s+/)
    .map((id) => (typeof root.getElementById === 'function' ? root.getElementById(id) : null)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
}

/** Help text, error message and group label that explain a field. */
function descriptionFor(element: Element): string | undefined {
  const parts = [
    idText(element, element.getAttribute('aria-describedby')),
    idText(element, element.getAttribute('aria-errormessage')),
  ];
  const fieldset = element.closest('fieldset');
  const legend = fieldset?.querySelector('legend')?.textContent?.trim();
  if (legend && (isInput(element) && ['radio', 'checkbox'].includes((element as HTMLInputElement).type)))
    parts.unshift(`Group: ${legend}`);
  const group = element.closest('[role="radiogroup"],[role="group"]');
  const groupName = group ? (group.getAttribute('aria-label') || idText(group, group.getAttribute('aria-labelledby'))) : '';
  if (groupName && !legend) parts.unshift(`Group: ${groupName}`);
  const text = parts.filter(Boolean).join(' · ');
  return text ? clean(text, 500) : undefined;
}

interface Candidate {
  element: Element;
  frame?: string | undefined;
  /** Offset of the containing same-origin frame, so rects stay in top-level viewport space. */
  offset: { x: number; y: number };
  index: number;
}

/** Walk the document, open shadow roots and same-origin frames (within extension permissions). */
function collect(document: Document, window: Window) {
  const candidates: Candidate[] = [];
  const crossOriginFrames: Array<{ src: string; title?: string }> = [];
  // Closed shadow roots cannot be detected or read from a content script.
  const closedShadow = false;
  let frames = 0;
  const visit = (root: Document | ShadowRoot, frame: string | undefined, offset: { x: number; y: number }) => {
    for (const element of Array.from(root.querySelectorAll(SELECTOR))) {
      const role = element.getAttribute('role');
      // Unnamed structural containers are noise; named regions stay (scroll targets, landmarks).
      if (
        role &&
        IGNORED_ROLES.has(role) &&
        !element.matches('a,button,input,textarea,select,[aria-label],[aria-labelledby]')
      )
        continue;
      candidates.push({ element, frame, offset, index: candidates.length });
    }
    for (const host of Array.from(root.querySelectorAll('*'))) {
      if (host.shadowRoot) visit(host.shadowRoot, frame ? `${frame} > shadow` : 'shadow', offset);
    }
    for (const iframe of Array.from(root.querySelectorAll('iframe'))) {
      let inner: Document | null;
      try {
        inner = iframe.contentDocument;
      } catch {
        inner = null;
      }
      const src = iframe.getAttribute('src') ? (iframe as HTMLIFrameElement).src : '';
      if (inner && frames < MAX_FRAMES && isVisible(iframe, window)) {
        frames += 1;
        const rect = iframe.getBoundingClientRect();
        visit(inner, `frame${src ? `:${src.slice(0, 200)}` : ''}`, { x: offset.x + rect.x, y: offset.y + rect.y });
      } else if (!inner && /^https?:/i.test(src) && isVisible(iframe, window)) {
        const title = iframe.getAttribute('title') ?? undefined;
        crossOriginFrames.push({ src: src.slice(0, 2_000), ...(title ? { title: title.slice(0, 300) } : {}) });
      }
    }
  };
  visit(document, undefined, { x: 0, y: 0 });
  return { candidates, crossOriginFrames, closedShadow };
}

function activeDialog(candidates: Candidate[], window: Window): Element | undefined {
  const dialogs = candidates
    .map((candidate) => candidate.element)
    .filter((element) => element.matches(DIALOGS) && isVisible(element, window));
  // The most recently inserted visible dialog is the active one.
  return dialogs.at(-1);
}

function toPageElement(candidate: Candidate, id: string, document: Document, window: Window, dialog: Element | undefined): PageElement {
  const { element } = candidate;
  const raw = element.getBoundingClientRect();
  const rect = { x: raw.x + candidate.offset.x, y: raw.y + candidate.offset.y, width: raw.width, height: raw.height };
  const name = accessibleName(element, document);
  const text = element.textContent?.trim();
  const editable =
    (element as HTMLElement).isContentEditable ||
    element.getAttribute('contenteditable') === 'true' ||
    element.getAttribute('contenteditable') === '';
  const form = element.closest('form');
  const expanded = element.getAttribute('aria-expanded');
  const pressed = element.getAttribute('aria-pressed');
  const ariaChecked = element.getAttribute('aria-checked');
  const ariaSelected = element.getAttribute('aria-selected');
  const field = isInput(element) || isTextArea(element) || isSelect(element) ? (element as HTMLInputElement) : undefined;
  const input = isInput(element) ? element : undefined;
  const required = field?.required || element.getAttribute('aria-required') === 'true';
  const invalid =
    element.getAttribute('aria-invalid') === 'true' ||
    Boolean(field && field.value && 'validity' in field && field.validity && !field.validity.valid);
  const placeholder = element.getAttribute('placeholder')?.trim();
  const description = descriptionFor(element);
  const autocomplete = element.getAttribute('autocomplete')?.trim();
  const files = input?.type === 'file' ? Array.from(input.files ?? []).map((file) => file.name.slice(0, 250)) : undefined;
  const role = element.getAttribute('role');
  // A role=textbox/combobox div shows its value as text.
  const displayValue =
    !field && (role === 'combobox' || role === 'textbox' || role === 'searchbox') ? text : undefined;
  return {
    id,
    kind: kindFor(element),
    ...(role ? { role } : {}),
    ...(name ? { name: clean(name, 500) } : {}),
    ...(text ? { text: clean(text, 1_000) } : {}),
    ...(tag(element) === 'a' && (element as HTMLAnchorElement).href && /^https?:/i.test((element as HTMLAnchorElement).href)
      ? { href: (element as HTMLAnchorElement).href }
      : {}),
    ...(associatedLabel(element) ? { label: associatedLabel(element) } : {}),
    ...(input ? { inputType: input.type } : {}),
    ...(field && !isSensitiveElement(field) && input?.type !== 'file'
      ? { value: (isSelect(element) ? (element.selectedOptions[0]?.text ?? element.value) : field.value).slice(0, 2_000) }
      : displayValue
        ? { value: clean(displayValue, 2_000) }
        : {}),
    ...(input && ['checkbox', 'radio'].includes(input.type)
      ? { checked: input.checked }
      : ariaChecked !== null
        ? { checked: ariaChecked === 'true' }
        : {}),
    ...(ariaSelected !== null ? { selected: ariaSelected === 'true' } : {}),
    ...(editable ? { contentEditable: true } : {}),
    ...(expanded !== null ? { expanded: expanded === 'true' } : {}),
    ...(pressed !== null ? { pressed: pressed === 'true' } : {}),
    ...(isScrollable(element, window) ? { scrollable: true } : {}),
    ...(form?.querySelector(SENSITIVE_IN_FORM) ? { formHasSensitiveField: true } : {}),
    ...(required ? { required: true } : {}),
    ...(invalid ? { invalid: true } : {}),
    ...(placeholder ? { placeholder: clean(placeholder, 300) } : {}),
    ...(description ? { description } : {}),
    ...(autocomplete && autocomplete !== 'off' && autocomplete !== 'on' ? { autocomplete: autocomplete.slice(0, 80) } : {}),
    ...(files ? { files: files.slice(0, 10) } : {}),
    ...(dialog && (dialog === element || dialog.contains(element)) ? { inDialog: true } : {}),
    ...(candidate.frame ? { frame: candidate.frame.slice(0, 300) } : {}),
    ...(isSelect(element)
      ? {
          options: Array.from(element.options)
            .slice(0, 200)
            .map((option) => option.text.slice(0, 500)),
        }
      : {}),
    visible: true,
    disabled:
      ['button', 'input', 'textarea', 'select'].includes(tag(element))
        ? (element as HTMLButtonElement).disabled
        : element.getAttribute('aria-disabled') === 'true',
    rect,
  };
}

/**
 * Choose what fits in the element budget. Priority: the active dialog, form
 * controls anywhere on the page (long application forms), then what is in or
 * near the viewport. Output keeps the dialog first and otherwise DOM order.
 */
function prioritise(candidates: Candidate[], window: Window, dialog: Element | undefined): Candidate[] {
  if (candidates.length <= MAX_ELEMENTS && !dialog) return candidates;
  const distance = (element: Element, offset: { y: number }) => {
    const rect = element.getBoundingClientRect();
    const top = rect.top + offset.y;
    const bottom = rect.bottom + offset.y;
    if (bottom >= 0 && top <= window.innerHeight) return 0;
    return top < 0 ? -bottom : top - window.innerHeight;
  };
  const tier = (candidate: Candidate) => {
    const element = candidate.element;
    if (dialog && (dialog === element || dialog.contains(element))) return 0;
    if (element.matches(FORM_CONTROL)) return 1;
    if (distance(element, candidate.offset) === 0) return element.matches('button,a,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[aria-haspopup]') ? 2 : 3;
    return 4;
  };
  const ranked = candidates
    .map((candidate) => ({ candidate, tier: tier(candidate), distance: distance(candidate.element, candidate.offset) }))
    .sort((a, b) => a.tier - b.tier || a.distance - b.distance || a.candidate.index - b.candidate.index)
    .slice(0, MAX_ELEMENTS);
  const chosen = new Set(ranked.map((entry) => entry.candidate));
  const inDialog = (candidate: Candidate) => Boolean(dialog && (dialog === candidate.element || dialog.contains(candidate.element)));
  return [
    ...candidates.filter((candidate) => chosen.has(candidate) && inDialog(candidate)),
    ...candidates.filter((candidate) => chosen.has(candidate) && !inDialog(candidate)),
  ];
}

function validationMessages(document: Document, window: Window, elements: PageElement[]): string[] {
  const messages: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = value ? clean(value, 500) : '';
    if (text && text.length >= 3 && !messages.includes(text)) messages.push(text);
  };
  for (const element of Array.from(
    document.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"],.error,.errors,.field-error,.invalid-feedback,[class*="error-message"],[class*="errorMessage"]'),
  )) {
    if (element.closest('[data-nudge-root]') || !isVisible(element, window)) continue;
    // An alert summary often lists several errors; keep them as separate messages.
    const items = Array.from(element.querySelectorAll('p,li'));
    if (items.length > 1) for (const item of items) push(item.textContent?.trim());
    else {
      const text = element.textContent?.trim() ?? '';
      if (text.length <= 300) push(text);
    }
  }
  for (const element of elements) if (element.invalid && element.description) push(`${element.name ?? element.label ?? 'Field'}: ${element.description}`);
  return messages.slice(0, 30);
}

export function captureSnapshot(
  document: Document,
  window: Window,
  documentId: string,
  registry: ElementRegistry,
  mutationCounter = 0,
): PageSnapshot {
  const { candidates, crossOriginFrames, closedShadow } = collect(document, window);
  const visibleCandidates = candidates.filter(
    ({ element }) =>
      !element.closest('[data-nudge-root]') &&
      (!isSensitiveElement(element) || isTargetableSensitiveField(element)) &&
      (isVisible(element, window) ||
        // Hidden file inputs behind styled "Upload" buttons are still attach targets.
        (isInput(element) && element.type === 'file' && element.isConnected)),
  );
  const dialog = activeDialog(visibleCandidates, window);
  const truncated = visibleCandidates.length > MAX_ELEMENTS;
  const elements = prioritise(visibleCandidates, window, dialog).map((candidate) =>
    toPageElement(candidate, registry.register(candidate.element), document, window, dialog),
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
  const validation = validationMessages(document, window, elements);
  const dialogElement = dialog ? elements.find((element) => element.inDialog && element.kind === 'dialog') : undefined;
  const dialogName = dialog ? clean(accessibleName(dialog, document).slice(0, 300), 300) : undefined;
  const focused = (() => {
    let active: Element | null = document.activeElement;
    while (active && (active as HTMLElement).shadowRoot?.activeElement) active = (active as HTMLElement).shadowRoot!.activeElement;
    return active ? elements.find((element) => registry.resolve(element.id) === active)?.id : undefined;
  })();
  const stateHash = stableHash(
    JSON.stringify([
      window.location.href,
      dialogName ?? '',
      elements.map((element) => [element.id, element.kind, element.name, element.value, element.checked, element.expanded, element.selected, element.disabled, element.files]),
      validation,
      text.slice(0, 40),
    ]),
  );

  return {
    snapshotId: `snap_${contentRandomUUID()}`,
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
      ...(crossOriginFrames.length ? (['cross_origin_frame'] as const) : []),
      ...(closedShadow ? (['closed_shadow_root'] as const) : []),
      ...(elements.some((element) => element.kind === 'canvas') ? (['canvas'] as const) : []),
    ],
    ...(dialog
      ? { dialog: { ...(dialogElement ? { elementId: dialogElement.id } : {}), ...(dialogName ? { name: dialogName } : {}) } }
      : {}),
    ...(validation.length ? { validation } : {}),
    ...(crossOriginFrames.length ? { frames: crossOriginFrames.slice(0, 20) } : {}),
    ...(focused ? { focusedElementId: focused } : {}),
    stateHash,
  };
}
