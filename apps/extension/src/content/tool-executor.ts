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

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
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
  if (!deps.registry.belongsToDocument(elementId)) return fail(deps, 'Element reference is stale; observe again.');
  const target = deps.registry.resolve(elementId);
  if (!target || !target.isConnected) return fail(deps, 'Element no longer exists; observe again.');
  if (!isVisible(target, deps.window)) return fail(deps, 'Element is not visible.');
  if ((target instanceof HTMLButtonElement || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) && target.disabled) {
    return fail(deps, 'Element is disabled.');
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
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        const value = call.mode === 'append' ? `${target.value}${call.text}` : call.text;
        setNativeValue(target, value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        const accepted = target.value === value;
        return accepted ? ok(deps, 'Text value verified.', true) : fail(deps, 'The site changed or rejected the text.');
      }
      if (isEditable(target)) {
        insertIntoEditable(target, window, call.text, call.mode === 'replace');
        const expected = call.mode === 'replace' ? call.text : undefined;
        if (expected !== undefined && target.textContent !== expected) return fail(deps, 'The editor rejected the text.');
        return ok(deps, 'Text entered.', true);
      }
      return fail(deps, 'Target is not a text field.');
    }
    case 'press_keys':
      if (target instanceof HTMLElement) target.focus();
      for (const chord of call.keys) pressChord(deps, chord, target);
      return ok(deps, `Pressed ${call.keys.join(', ')}.`, true);
    case 'select_option': {
      if (!(target instanceof HTMLSelectElement)) return fail(deps, 'Target is not a select control.');
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
