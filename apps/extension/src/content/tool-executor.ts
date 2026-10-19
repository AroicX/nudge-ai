import { parseKeyChord, type ContentResult, type DomToolCall } from '@nudge/contracts';
import { redactText } from '@nudge/core';

import type { ElementRegistry } from './element-registry';
import { isSensitiveElement, isVisible } from './snapshot';

export interface ToolExecutorDeps {
  document: Document;
  window: Window;
  documentId: string;
  registry: ElementRegistry;
  visualizeTarget?: ((target: Element) => Promise<void>) | undefined;
  observeText(): string[];
  mutationCount(): number;
}

type Result = ContentResult;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"],[contenteditable=""]';

const KEY_CODES: Record<string, string> = {
  Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Space: 'Space', F2: 'F2',
};

function ok(deps: ToolExecutorDeps, detail: string, changed: boolean, extra: Partial<Result> = {}): Result {
  return { ok: true, detail, changed, documentId: deps.documentId, ...extra };
}
function fail(deps: ToolExecutorDeps, detail: string): Result {
  return { ok: false, detail, changed: false, documentId: deps.documentId };
}

function centre(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function mouse(target: Element, type: string, window: Window, init: MouseEventInit = {}) {
  const { x, y } = centre(target);
  const Ctor = type.startsWith('pointer') && 'PointerEvent' in window ? (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent : MouseEvent;
  return target.dispatchEvent(
    new Ctor(type, { bubbles: !['mouseenter', 'pointerenter'].includes(type), cancelable: true, composed: true, clientX: x, clientY: y, ...init }),
  );
}

function clickSequence(target: Element, window: Window, detail: number) {
  mouse(target, 'pointerdown', window, { detail, button: 0, buttons: 1 });
  mouse(target, 'mousedown', window, { detail, button: 0, buttons: 1 });
  if (target instanceof HTMLElement && target.matches(FOCUSABLE)) target.focus();
  mouse(target, 'pointerup', window, { detail, button: 0 });
  mouse(target, 'mouseup', window, { detail, button: 0 });
  mouse(target, 'click', window, { detail, button: 0 });
}

const tagOf = (element: Element) => element.tagName.toLowerCase();
const isTextField = (element: Element): element is HTMLInputElement | HTMLTextAreaElement =>
  tagOf(element) === 'textarea' ||
  (tagOf(element) === 'input' &&
    !['checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image', 'hidden', 'range', 'color'].includes(
      (element as HTMLInputElement).type,
    ));
const isSelectElement = (element: Element): element is HTMLSelectElement => tagOf(element) === 'select';
const viewFor = (element: Element, fallback: Window): Window =>
  (element.ownerDocument?.defaultView as Window | null) ?? fallback;

/** React and similar libraries track the value via the prototype setter; set it there. */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const view = element.ownerDocument?.defaultView ?? window;
  const prototype = tagOf(element) === 'input' ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
}

const settle = (window: Window, ms = 80) => new Promise<void>((done) => window.setTimeout(done, ms));
const normaliseText = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

function isComboLike(element: Element): boolean {
  return (
    element.getAttribute('role') === 'combobox' ||
    element.hasAttribute('aria-autocomplete') ||
    (tagOf(element) === 'input' && element.hasAttribute('list')) ||
    element.getAttribute('aria-haspopup') === 'listbox'
  );
}

function fieldValidation(target: Element): string[] {
  const root = target.getRootNode() as Document | ShadowRoot;
  const byId = (id: string) => (typeof root.getElementById === 'function' ? root.getElementById(id) : null);
  const messages = [
    ...(target.getAttribute('aria-describedby') ?? '').split(/\s+/),
    ...(target.getAttribute('aria-errormessage') ?? '').split(/\s+/),
  ]
    .filter(Boolean)
    .map((id) => byId(id)?.textContent?.trim() ?? '')
    .filter((text) => text.length >= 3);
  const nativeMessage =
    isTextField(target) && target.value && !target.validity.valid ? target.validationMessage : '';
  return [...messages, ...(nativeMessage ? [nativeMessage] : [])].map((text) => redactText(text).slice(0, 500)).slice(0, 5);
}

/** Options currently offered by a dropdown/listbox/autocomplete, nearest to the control first. */
function visibleOptions(deps: ToolExecutorDeps, control: Element): HTMLElement[] {
  const root = control.getRootNode() as Document | ShadowRoot;
  const controlsId = control.getAttribute('aria-controls') ?? control.getAttribute('aria-owns');
  const owned = controlsId && typeof root.getElementById === 'function' ? root.getElementById(controlsId) : null;
  const scopes: ParentNode[] = [
    ...(owned ? [owned] : []),
    ...(control.closest('[role="radiogroup"],[role="group"],fieldset') ? [control.closest('[role="radiogroup"],[role="group"],fieldset')!] : []),
    root,
    ...(root !== deps.document ? [deps.document] : []),
  ];
  const selector =
    '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[role="treeitem"],[role="listbox"] li,datalist option,input[type="radio"]';
  for (const scope of scopes) {
    const found = Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(
      (element) =>
        !element.closest('[data-nudge-root]') &&
        (tagOf(element) === 'option' || isVisible(element, deps.window) || (tagOf(element) === 'input' && isVisible(element.closest('label') ?? element, deps.window))),
    );
    if (found.length) return found.slice(0, 200);
  }
  return [];
}

function optionLabel(option: HTMLElement): string {
  if (tagOf(option) === 'input') {
    const input = option as HTMLInputElement;
    return (
      Array.from(input.labels ?? []).map((label) => label.textContent ?? '').join(' ').trim() ||
      input.getAttribute('aria-label') ||
      input.value
    );
  }
  return (option.getAttribute('aria-label') || option.textContent || (option as HTMLOptionElement).value || '').trim();
}

function bestOption(options: HTMLElement[], wanted: string): HTMLElement | undefined {
  const target = normaliseText(wanted);
  const labelled = options.map((option) => ({ option, label: normaliseText(optionLabel(option)) }));
  return (
    labelled.find((entry) => entry.label === target) ??
    labelled.find((entry) => entry.label.startsWith(target)) ??
    labelled.find((entry) => target.length >= 3 && entry.label.includes(target))
  )?.option;
}

function displayedValue(control: Element): string {
  if (isTextField(control) || isSelectElement(control))
    return isSelectElement(control) ? (control.selectedOptions[0]?.text ?? control.value) : control.value;
  return (control.textContent ?? '').trim();
}

/** Type the way a person does: focus, select, beforeinput/input/change; blur commits non-combobox fields. */
async function typeIntoField(
  deps: ToolExecutorDeps,
  target: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  mode: 'replace' | 'append',
  options: { commit: boolean },
): Promise<Result> {
  const view = viewFor(target, deps.window);
  target.focus();
  if (mode === 'replace') target.select?.();
  const value = mode === 'append' ? `${target.value}${text}` : text;
  const InputEventCtor = (view as unknown as { InputEvent?: typeof InputEvent }).InputEvent ?? InputEvent;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: text.slice(-1) || 'Unidentified', bubbles: true, composed: true }));
  target.dispatchEvent(
    new InputEventCtor('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: mode === 'replace' ? 'insertReplacementText' : 'insertText', data: text }),
  );
  setNativeValue(target, value);
  target.dispatchEvent(new InputEventCtor('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key: text.slice(-1) || 'Unidentified', bubbles: true, composed: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  if (options.commit) {
    target.blur();
    target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
  }
  // Let controlled components re-render, then read back what the application kept.
  await settle(deps.window);
  const retained = target.value;
  const validation = fieldValidation(target);
  const extra: Partial<Result> = { fieldValue: retained.slice(0, 2_000), ...(validation.length ? { validation } : {}) };
  if (isComboLike(target)) {
    const offered = visibleOptions(deps, target).map((option) => optionLabel(option).slice(0, 300)).filter(Boolean);
    if (offered.length) extra.options = offered.slice(0, 50);
  }
  if (retained === value)
    return ok(deps, extra.options?.length ? 'Text retained; the field is offering suggestions — use choose_option to pick one.' : 'Text value retained by the page.', true, extra);
  const sameDigits = value.replace(/\D/g, '').length >= 7 && retained.replace(/\D/g, '') === value.replace(/\D/g, '');
  if (sameDigits || normaliseText(retained) === normaliseText(value))
    return ok(deps, `The page reformatted the value to “${retained.slice(0, 200)}”.`, true, extra);
  return {
    ...fail(deps, `The page did not keep the value (it now holds “${retained.slice(0, 200)}”).${validation.length ? ` Validation: ${validation.join(' ')}` : ''}`),
    ...extra,
    errorCategory: validation.length ? 'validation_error' : 'value_rejected',
  };
}

async function chooseOption(
  deps: ToolExecutorDeps,
  target: Element,
  value: string,
  query: string | undefined,
): Promise<Result> {
  // Native select: match by visible text.
  if (isSelectElement(target)) {
    const option = Array.from(target.options).find((candidate) => normaliseText(candidate.text) === normaliseText(value)) ??
      Array.from(target.options).find((candidate) => normaliseText(candidate.text).startsWith(normaliseText(value)));
    if (!option)
      return { ...fail(deps, 'Requested option is not available.'), errorCategory: 'not_found', options: Array.from(target.options).map((o) => o.text.slice(0, 300)).slice(0, 50) };
    target.value = option.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(deps.window);
    return target.value === option.value
      ? ok(deps, `Selected “${option.text}”.`, true, { fieldValue: option.text })
      : { ...fail(deps, 'The page rejected the selection.'), errorCategory: 'value_rejected' };
  }
  // Radio inputs / radio groups: click the matching radio.
  if (tagOf(target) === 'input' && (target as HTMLInputElement).type === 'radio') {
    const group = (target as HTMLInputElement).name;
    const root = target.getRootNode() as Document;
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
      (radio) => !group || radio.name === group,
    );
    const match = bestOption(radios, value);
    if (!match) return { ...fail(deps, 'No radio button matches that answer.'), errorCategory: 'not_found', options: radios.map(optionLabel).slice(0, 50) };
    clickSequence(match, viewFor(match, deps.window), 1);
    await settle(deps.window);
    return (match as HTMLInputElement).checked
      ? ok(deps, `Chose “${optionLabel(match)}”.`, true, { fieldValue: optionLabel(match) })
      : { ...fail(deps, 'The radio button did not stay selected.'), errorCategory: 'value_rejected' };
  }
  // Custom dropdowns, comboboxes and autocomplete.
  if (query && isTextField(target)) {
    await typeIntoField(deps, target, query, 'replace', { commit: false });
  } else {
    mouse(target, 'pointerover', deps.window);
    clickSequence(target, viewFor(target, deps.window), 1);
    if (isTextField(target)) target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  }
  let options: HTMLElement[] = [];
  let match: HTMLElement | undefined;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    options = visibleOptions(deps, target);
    match = bestOption(options, value);
    if (match) break;
    await settle(deps.window, 100);
  }
  if (!match) {
    if (tagOf(target) !== 'input') target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return {
      ...fail(deps, options.length ? `No option matches “${value}”.` : 'No options appeared after opening the control.'),
      errorCategory: options.length ? 'not_found' : 'timeout',
      options: options.map((option) => optionLabel(option).slice(0, 300)).filter(Boolean).slice(0, 50),
    };
  }
  match.scrollIntoView?.({ block: 'nearest' });
  mouse(match, 'pointerover', deps.window);
  clickSequence(match, viewFor(match, deps.window), 1);
  await settle(deps.window, 120);
  const label = optionLabel(match);
  const shown = displayedValue(target);
  const retained =
    normaliseText(shown).includes(normaliseText(label)) ||
    normaliseText(shown).includes(normaliseText(value)) ||
    match.getAttribute('aria-selected') === 'true' ||
    match.getAttribute('aria-checked') === 'true' ||
    (tagOf(match) === 'input' && (match as HTMLInputElement).checked);
  return retained
    ? ok(deps, `Chose “${label.slice(0, 200)}”.`, true, { fieldValue: (shown || label).slice(0, 2_000) })
    : {
        ...fail(deps, `Clicked “${label.slice(0, 200)}”, but the control shows “${shown.slice(0, 200)}”.`),
        errorCategory: 'value_rejected',
        fieldValue: shown.slice(0, 2_000),
      };
}

/** Find the real file input for an upload control (hidden inputs behind styled buttons are common). */
export function fileInputFor(target: Element): HTMLInputElement | undefined {
  const isFile = (element: Element | null | undefined): element is HTMLInputElement =>
    Boolean(element && tagOf(element) === 'input' && (element as HTMLInputElement).type === 'file');
  if (isFile(target)) return target;
  if (tagOf(target) === 'label') {
    const control = (target as HTMLLabelElement).control;
    if (isFile(control)) return control;
  }
  const inside = target.querySelector?.('input[type="file"]');
  if (isFile(inside)) return inside;
  let scope: Element | null = target.parentElement;
  for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
    const nearby = scope.querySelectorAll('input[type="file"]');
    if (nearby.length === 1 && isFile(nearby[0])) return nearby[0];
  }
  return undefined;
}

/** Attach a file through the input's own change pipeline (DataTransfer), then verify. */
export async function attachFile(
  deps: Pick<ToolExecutorDeps, 'document' | 'window' | 'documentId'>,
  target: Element,
  file: { name: string; mime: string; base64: string },
): Promise<Result> {
  const input = fileInputFor(target);
  if (!input) return { ok: false, detail: 'No file upload field was found at that element.', changed: false, documentId: deps.documentId, errorCategory: 'not_found' };
  if (input.disabled) return { ok: false, detail: 'The upload field is disabled.', changed: false, documentId: deps.documentId, errorCategory: 'disabled' };
  const accept = (input.getAttribute('accept') ?? '').toLowerCase();
  const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  if (accept && !accept.split(',').map((item) => item.trim()).some((item) => item === extension || item === file.mime || (item.endsWith('/*') && file.mime.startsWith(item.slice(0, -1)))))
    return { ok: false, detail: `The form accepts ${accept}; “${file.name}” is ${file.mime}.`, changed: false, documentId: deps.documentId, errorCategory: 'value_rejected' };
  const view = viewFor(input, deps.window) as Window & { File: typeof File; DataTransfer?: typeof DataTransfer };
  const binary = view.atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new view.File([bytes], file.name, { type: file.mime });
  const transfer = makeDataTransfer(view);
  try {
    transfer.items.add(blob);
    input.files = transfer.files;
  } catch {
    return { ok: false, detail: 'This browser context does not allow setting files on that field.', changed: false, documentId: deps.documentId, errorCategory: 'unsupported' };
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(deps.window, 200);
  const names = Array.from(input.files ?? []).map((item) => item.name);
  if (!names.includes(file.name))
    return { ok: false, detail: 'The upload field did not keep the file.', changed: false, documentId: deps.documentId, errorCategory: 'value_rejected' };
  const pageText = deps.document.body?.innerText ?? deps.document.body?.textContent ?? '';
  const shown = pageText.includes(file.name);
  return {
    ok: true,
    detail: shown ? `Attached “${file.name}”; the page shows it.` : `Attached “${file.name}” to the upload field.`,
    changed: true,
    documentId: deps.documentId,
    fieldValue: file.name,
    validation: fieldValidation(input),
  };
}

function isEditable(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && (element.isContentEditable || ['true', ''].includes(element.getAttribute('contenteditable') ?? 'x'));
}

function insertIntoEditable(element: HTMLElement, window: Window, text: string, replace: boolean): boolean {
  element.focus();
  const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: replace ? 'insertReplacementText' : 'insertText', data: text });
  if (!element.dispatchEvent(before)) return element.textContent === text;
  element.textContent = replace ? text : `${element.textContent ?? ''}${text}`;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
}

function focusables(document: Document, window: Window): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest('[data-nudge-root]') && isVisible(element, window),
  );
}

function makeDataTransfer(window: Window): DataTransfer {
  const Ctor = (window as unknown as { DataTransfer?: new () => DataTransfer }).DataTransfer;
  if (Ctor) {
    try {
      return new Ctor();
    } catch {
      /* fall through */
    }
  }
  const store = new Map<string, string>();
  return {
    dropEffect: 'move',
    effectAllowed: 'all',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: (format?: string) => (format ? store.delete(format) : store.clear()),
    getData: (format: string) => store.get(format) ?? '',
    setData: (format: string, data: string) => void store.set(format, data),
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

function dragEvent(window: Window, type: string, dataTransfer: DataTransfer, target: Element): Event {
  const { x, y } = centre(target);
  const DragCtor = (window as unknown as { DragEvent?: typeof DragEvent }).DragEvent;
  if (DragCtor) {
    try {
      return new DragCtor(type, { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y });
    } catch {
      /* jsdom: fall through */
    }
  }
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

function resolve(deps: ToolExecutorDeps, elementId: string): Element | Result {
  if (!deps.registry.belongsToDocument(elementId))
    return { ...fail(deps, 'Element reference is stale; observe again.'), errorCategory: 'stale_element' };
  const target = deps.registry.resolve(elementId);
  if (!target || !target.isConnected)
    return { ...fail(deps, 'Element no longer exists; observe again.'), errorCategory: 'stale_element' };
  if (!isVisible(target, deps.window))
    return { ...fail(deps, 'Element is not visible; scroll, open its section, or observe again.'), errorCategory: 'not_visible' };
  if (['button', 'input', 'textarea', 'select'].includes(target.tagName.toLowerCase()) && (target as HTMLButtonElement).disabled) {
    return { ...fail(deps, 'Element is disabled.'), errorCategory: 'disabled' };
  }
  return target;
}

function pressChord(deps: ToolExecutorDeps, chord: string, explicit?: Element): void {
  const parsed = parseKeyChord(chord)!;
  const { document, window } = deps;
  const target = (explicit ?? document.activeElement ?? document.body) as HTMLElement;
  const key = parsed.key === 'Space' ? ' ' : parsed.key;
  const code = KEY_CODES[parsed.key] ?? (key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : '') : '');
  const modifiers = {
    ctrlKey: parsed.modifiers.includes('Control'),
    metaKey: parsed.modifiers.includes('Meta'),
    shiftKey: parsed.modifiers.includes('Shift'),
    altKey: parsed.modifiers.includes('Alt'),
  };
  const init = { key, code, bubbles: true, cancelable: true, composed: true, ...modifiers };
  const proceed = target.dispatchEvent(new KeyboardEvent('keydown', init));
  const printable = key.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey;
  if (printable) target.dispatchEvent(new KeyboardEvent('keypress', init));
  if (proceed) {
    // Emulate the browser defaults that synthetic events do not trigger. Enter never submits.
    if (parsed.key === 'Tab') {
      const list = focusables(document, window);
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next = list[(index + (modifiers.shiftKey ? -1 : 1) + list.length) % list.length];
      next?.focus();
    } else if ((modifiers.ctrlKey || modifiers.metaKey) && key.toLowerCase() === 'a') {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.select();
    } else if (printable || parsed.key === 'Backspace') {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const next = parsed.key === 'Backspace' ? target.value.slice(0, -1) : `${target.value}${key}`;
        setNativeValue(target, next);
        target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: parsed.key === 'Backspace' ? 'deleteContentBackward' : 'insertText', data: printable ? key : null }));
      } else if (isEditable(target)) {
        if (parsed.key === 'Backspace') {
          target.textContent = (target.textContent ?? '').slice(0, -1);
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        } else insertIntoEditable(target, window, key, false);
      }
    } else if (['PageDown', 'PageUp', 'Space', 'End', 'Home', 'ArrowDown', 'ArrowUp'].includes(parsed.key) && (target === document.body || target === document.documentElement)) {
      const amount = { PageDown: 0.85, Space: 0.85, PageUp: -0.85, ArrowDown: 0.1, ArrowUp: -0.1 }[parsed.key as 'PageDown'];
      if (parsed.key === 'End') window.scrollTo({ top: document.documentElement.scrollHeight });
      else if (parsed.key === 'Home') window.scrollTo({ top: 0 });
      else window.scrollBy({ top: window.innerHeight * amount });
    }
  }
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

function textCorpus(deps: ToolExecutorDeps): string {
  return deps.observeText().join('\n').toLowerCase();
}

async function waitFor(deps: ToolExecutorDeps, call: Extract<DomToolCall, { tool: 'wait_for' }>): Promise<Result> {
  const deadline = Date.now() + call.timeoutMs;
  let lastMutation = deps.mutationCount();
  let quietSince = Date.now();
  while (Date.now() <= deadline) {
    const condition = call.condition;
    const corpus = condition.kind === 'idle' || condition.kind === 'url_matches' ? '' : textCorpus(deps);
    let met = false;
    switch (condition.kind) {
      case 'text_present':
        met = corpus.includes(condition.text.toLowerCase());
        break;
      case 'text_absent':
        met = !corpus.includes(condition.text.toLowerCase());
        break;
      case 'url_matches':
        met = deps.window.location.href.startsWith(condition.prefix);
        break;
      case 'element_count': {
        const count = corpus.split(condition.text.toLowerCase()).length - 1;
        met = (condition.min === undefined || count >= condition.min) && (condition.max === undefined || count <= condition.max);
        break;
      }
      case 'idle': {
        const current = deps.mutationCount();
        if (current !== lastMutation) {
          lastMutation = current;
          quietSince = Date.now();
        }
        met = Date.now() - quietSince >= 300;
        break;
      }
    }
    if (met) return ok(deps, 'Condition met.', false);
    await new Promise((done) => deps.window.setTimeout(done, 100));
  }
  return fail(deps, 'Timed out waiting for the condition.');
}

export async function executeTool(deps: ToolExecutorDeps, call: DomToolCall): Promise<Result> {
  const { document, window } = deps;
  if (call.tool === 'wait_for') return waitFor(deps, call);
  if (call.tool === 'read_text') {
    if (!call.elementId) {
      return ok(deps, 'Read page text.', false, { text: redactText(document.body?.innerText ?? document.body?.textContent ?? '').slice(0, 20_000) });
    }
    const target = resolve(deps, call.elementId);
    if (!(target instanceof Element)) return target;
    if (isSensitiveElement(target)) return fail(deps, 'That field is private.');
    return ok(deps, 'Read element text.', false, { text: redactText(target.textContent ?? '').slice(0, 20_000) });
  }
  if (call.tool === 'press_keys' && !call.elementId) {
    for (const chord of call.keys) pressChord(deps, chord);
    return ok(deps, `Pressed ${call.keys.join(', ')}.`, true);
  }
  if (call.tool === 'scroll' && !call.elementId) {
    const before = window.scrollY;
    const amount = call.amount === 'viewport' ? window.innerHeight * 0.8 : call.amount === 'end' ? document.documentElement.scrollHeight : call.amount;
    const sign = call.direction === 'up' || call.direction === 'left' ? -1 : 1;
    const vertical = call.direction === 'up' || call.direction === 'down';
    window.scrollBy({ left: vertical ? 0 : sign * amount, top: vertical ? sign * amount : 0 });
    return ok(deps, 'Scrolled the page.', window.scrollY !== before);
  }

  const primaryId = call.tool === 'drag' ? call.fromElementId : call.elementId!;
  const target = resolve(deps, primaryId);
  if (!(target instanceof Element)) return target;

  const pointer = ['click', 'double_click', 'hover', 'drag'].includes(call.tool);
  if (pointer) await deps.visualizeTarget?.(target);

  switch (call.tool) {
    case 'inspect_element': {
      const rect = target.getBoundingClientRect();
      const label = `${target.getAttribute('aria-label') ?? ''} ${(target as HTMLInputElement).labels ? Array.from((target as HTMLInputElement).labels ?? []).map((l) => l.textContent).join(' ') : ''} ${target.getAttribute('placeholder') ?? ''} ${target.getAttribute('name') ?? ''}`;
      return ok(deps, 'Inspected element.', false, {
        element: {
          kind: target.tagName.toLowerCase(),
          ...(target.getAttribute('role') ? { role: target.getAttribute('role')! } : {}),
          ...(label.trim() ? { name: label.trim().slice(0, 500) } : {}),
          ...(target instanceof HTMLInputElement ? { inputType: target.type, autocomplete: target.autocomplete } : {}),
          codeLike: /\b(code|otp|one[- ]time|verification|passcode)\b/i.test(label),
          formHasSensitiveField: Boolean(target.closest('form')?.querySelector('input[type="password"],[autocomplete^="cc-"]')),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        },
        point: centre(target),
      });
    }
    case 'click':
      mouse(target, 'pointerover', window);
      mouse(target, 'mouseover', window);
      clickSequence(target, window, 1);
      return ok(deps, 'Clicked.', false, { point: centre(target) });
    case 'double_click':
      clickSequence(target, window, 1);
      clickSequence(target, window, 2);
      mouse(target, 'dblclick', window, { detail: 2 });
      return ok(deps, 'Double-clicked.', false, { point: centre(target) });
    case 'hover':
      mouse(target, 'pointerover', window);
      mouse(target, 'pointerenter', window);
      mouse(target, 'mouseover', window);
      mouse(target, 'mouseenter', window);
      mouse(target, 'pointermove', window);
      mouse(target, 'mousemove', window);
      return ok(deps, 'Hovered.', false, { point: centre(target) });
    case 'focus':
      if (!(target instanceof HTMLElement)) return fail(deps, 'Element cannot take focus.');
      target.focus();
      return ok(deps, 'Focused.', document.activeElement === target);
    case 'type_text': {
      if (isSensitiveElement(target)) return fail(deps, 'Sensitive fields are user-only.');
      if (isTextField(target))
        return typeIntoField(deps, target, call.text, call.mode, { commit: !isComboLike(target) });
      if (isEditable(target)) {
        insertIntoEditable(target, window, call.text, call.mode === 'replace');
        await settle(deps.window);
        const expected = call.mode === 'replace' ? call.text : undefined;
        if (expected !== undefined && normaliseText(target.textContent ?? '') !== normaliseText(expected))
          return { ...fail(deps, 'The editor rejected the text.'), errorCategory: 'value_rejected', fieldValue: (target.textContent ?? '').slice(0, 2_000) };
        return ok(deps, 'Text entered.', true, { fieldValue: (target.textContent ?? '').slice(0, 2_000) });
      }
      return { ...fail(deps, 'Target is not a text field. For dropdowns use choose_option; for uploads use attach_document.'), errorCategory: 'unsupported' };
    }
    case 'choose_option':
      if (isSensitiveElement(target)) return fail(deps, 'Sensitive fields are user-only.');
      return chooseOption(deps, target, call.value, call.query);
    case 'press_keys':
      if (target instanceof HTMLElement) target.focus();
      for (const chord of call.keys) pressChord(deps, chord, target);
      return ok(deps, `Pressed ${call.keys.join(', ')}.`, true);
    case 'select_option': {
      if (!isSelectElement(target)) return { ...fail(deps, 'Target is not a native select. Use choose_option for custom dropdowns.'), errorCategory: 'unsupported' };
      const option = Array.from(target.options).find((candidate) => candidate.value === call.value || candidate.text === call.value);
      if (!option) return fail(deps, 'Requested option is not available.');
      target.value = option.value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return target.value === option.value ? ok(deps, 'Selection verified.', true) : fail(deps, 'Selection was rejected.');
    }
    case 'scroll': {
      if (!(target instanceof HTMLElement)) return fail(deps, 'Element cannot scroll.');
      const before = target.scrollTop + target.scrollLeft;
      const amount = call.amount === 'viewport' ? target.clientHeight * 0.8 : call.amount === 'end' ? target.scrollHeight : call.amount;
      const sign = call.direction === 'up' || call.direction === 'left' ? -1 : 1;
      const vertical = call.direction === 'up' || call.direction === 'down';
      target.scrollBy({ left: vertical ? 0 : sign * amount, top: vertical ? sign * amount : 0 });
      return ok(deps, 'Scrolled the container.', target.scrollTop + target.scrollLeft !== before);
    }
    case 'drag': {
      const destination = resolve(deps, call.toElementId);
      if (!(destination instanceof Element)) return destination;
      const transfer = makeDataTransfer(window);
      mouse(target, 'pointerdown', window, { buttons: 1 });
      mouse(target, 'mousedown', window, { buttons: 1 });
      target.dispatchEvent(dragEvent(window, 'dragstart', transfer, target));
      destination.dispatchEvent(dragEvent(window, 'dragenter', transfer, destination));
      destination.dispatchEvent(dragEvent(window, 'dragover', transfer, destination));
      mouse(destination, 'mousemove', window, { buttons: 1 });
      destination.dispatchEvent(dragEvent(window, 'drop', transfer, destination));
      target.dispatchEvent(dragEvent(window, 'dragend', transfer, target));
      mouse(destination, 'pointerup', window);
      mouse(destination, 'mouseup', window);
      return ok(deps, 'Dragged.', false, { point: centre(destination) });
    }
  }
}
