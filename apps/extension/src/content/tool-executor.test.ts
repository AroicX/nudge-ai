// @vitest-environment jsdom

import type { ContentResult, DomToolCall, PageSnapshot } from '@nudge/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPageAdapter } from './page-adapter';
import { ensureCursorForTest } from './action-cursor';

const rectStub = () => ({ x: 10, y: 10, width: 100, height: 30, top: 10, left: 10, right: 110, bottom: 40, toJSON: () => ({}) });

beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(rectStub as never);
});
afterEach(() => vi.restoreAllMocks());

async function setup(markup: string) {
  document.body.innerHTML = markup;
  const adapter = createPageAdapter({ document, window, documentId: 'doc_1' });
  const observed = (await adapter.handle({ type: 'observe' })) as ContentResult;
  const snapshot = observed.snapshot as PageSnapshot;
  const id = (predicate: (element: PageSnapshot['elements'][number]) => boolean) =>
    snapshot.elements.find(predicate)!.id;
  const run = (call: DomToolCall) => adapter.handle({ type: 'execute', call, documentId: 'doc_1', generation: 0 });
  return { adapter, snapshot, id, run };
}

describe('content tool executor', () => {
  it('double_click dispatches dblclick after two clicks', async () => {
    const { id, run } = await setup('<button>Open</button>');
    const log: string[] = [];
    const button = document.querySelector('button')!;
    for (const type of ['click', 'dblclick']) button.addEventListener(type, () => log.push(type));
    const result = await run({ tool: 'double_click', tabId: 1, elementId: id((e) => e.kind === 'button') });
    expect(result.ok).toBe(true);
    expect(log).toEqual(['click', 'click', 'dblclick']);
  });

  it('hover dispatches pointerover and mouseover', async () => {
    const { id, run } = await setup('<button>Menu</button>');
    const log: string[] = [];
    const button = document.querySelector('button')!;
    for (const type of ['pointerover', 'mouseover', 'click']) button.addEventListener(type, () => log.push(type));
    await run({ tool: 'hover', tabId: 1, elementId: id((e) => e.kind === 'button') });
    expect(log).toEqual(['pointerover', 'mouseover']);
  });

  it('press_keys Shift+Tab moves focus backwards', async () => {
    const { run } = await setup('<input aria-label="First" /><input aria-label="Second" />');
    const [first, second] = Array.from(document.querySelectorAll('input'));
    second!.focus();
    const result = await run({ tool: 'press_keys', tabId: 1, keys: ['Shift+Tab'] });
    expect(result.ok).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('Enter does not submit forms', async () => {
    const { id, run } = await setup('<form><input aria-label="Query" /><button type="submit">Go</button></form>');
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('form')!.addEventListener('submit', submit);
    await run({ tool: 'press_keys', tabId: 1, keys: ['Enter'], elementId: id((e) => e.kind === 'input') });
    expect(submit).not.toHaveBeenCalled();
  });

  it('press_keys types printable characters into the focused field', async () => {
    const { id, run } = await setup('<input aria-label="Query" />');
    await run({ tool: 'press_keys', tabId: 1, keys: ['h', 'i'], elementId: id((e) => e.kind === 'input') });
    expect(document.querySelector('input')!.value).toBe('hi');
  });

  it('type_text into contenteditable updates text and fires input', async () => {
    const { id, run } = await setup('<div contenteditable="true" role="gridcell" aria-label="A1">old</div>');
    const input = vi.fn();
    document.querySelector('[contenteditable]')!.addEventListener('input', input);
    const result = await run({ tool: 'type_text', tabId: 1, elementId: id((e) => e.name === 'A1'), text: 'Acme', mode: 'replace' });
    expect(result.ok).toBe(true);
    expect(document.querySelector('[contenteditable]')!.textContent).toBe('Acme');
    expect(input).toHaveBeenCalled();
  });

  it('drag fires dragstart, drop and dragend with a shared dataTransfer', async () => {
    const { id, run } = await setup('<div draggable="true" role="button" aria-label="Card">Card</div><div role="button" aria-label="Done column">Done</div>');
    const transfers: unknown[] = [];
    const log: string[] = [];
    const [card, column] = Array.from(document.querySelectorAll('[role=button]'));
    card!.addEventListener('dragstart', (event) => { log.push('dragstart'); transfers.push((event as DragEvent).dataTransfer); });
    column!.addEventListener('drop', (event) => { log.push('drop'); transfers.push((event as DragEvent).dataTransfer); });
    card!.addEventListener('dragend', () => log.push('dragend'));
    await run({ tool: 'drag', tabId: 1, fromElementId: id((e) => e.name === 'Card'), toElementId: id((e) => e.name === 'Done column') });
    expect(log).toEqual(['dragstart', 'drop', 'dragend']);
    expect(transfers[0]).toBeDefined();
    expect(transfers[0]).toBe(transfers[1]);
  });

  it('scrolls a container by elementId', async () => {
    const { id, run } = await setup('<div role="region" aria-label="List" style="overflow:auto;height:50px"><p>a</p></div>');
    const list = document.querySelector('[role=region]') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 500 });
    Object.defineProperty(list, 'clientHeight', { value: 50 });
    list.scrollBy = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
      if (typeof options === 'object') this.scrollTop += options.top ?? 0;
    }) as never;
    await run({ tool: 'scroll', tabId: 1, direction: 'down', amount: 100, elementId: id((e) => e.name === 'List') });
    expect(list.scrollTop).toBe(100);
  });

  it('fails cleanly on a disconnected element', async () => {
    const { id, run } = await setup('<button>Go</button>');
    const target = id((e) => e.kind === 'button');
    document.querySelector('button')!.remove();
    const result = await run({ tool: 'click', tabId: 1, elementId: target });
    expect(result).toMatchObject({ ok: false, detail: expect.stringMatching(/no longer exists/) });
  });

  it('wait_for resolves when text appears', async () => {
    const { run } = await setup('<main><p>Loading</p></main>');
    setTimeout(() => {
      document.querySelector('main')!.innerHTML = '<p>Results ready</p>';
    }, 150);
    const result = await run({ tool: 'wait_for', tabId: 1, condition: { kind: 'text_present', text: 'Results ready' }, timeoutMs: 2000 });
    expect(result.ok).toBe(true);
  });
});

describe('snapshot', () => {
  it('redacts verification code text and marks canvas inaccessible', async () => {
    const { snapshot } = await setup('<main><p>Your verification code is 482913</p><canvas aria-label="Design"></canvas></main>');
    expect(JSON.stringify(snapshot)).not.toContain('482913');
    expect(snapshot.inaccessible).toContain('canvas');
    expect(snapshot.elements.some((element) => element.kind === 'canvas')).toBe(true);
  });

  it('flags fields inside forms with sensitive inputs', async () => {
    const { snapshot } = await setup('<form><input aria-label="Card holder" /><input type="password" aria-label="Password" /><button>Pay</button></form>');
    expect(snapshot.elements.find((element) => element.name === 'Pay')?.formHasSensitiveField).toBe(true);
  });

  it('excludes the cursor overlay and gives it pointer-events none', async () => {
    const cursor = ensureCursorForTest(document);
    const { snapshot } = await setup('<button>Go</button>');
    document.documentElement.append(cursor);
    expect(cursor.style.pointerEvents).toBe('none');
    expect(snapshot.elements.every((element) => !element.name?.includes('nudge'))).toBe(true);
  });

  it('counts mutations between observations', async () => {
    const { adapter } = await setup('<main><p>a</p></main>');
    document.querySelector('main')!.append(document.createElement('p'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = (await adapter.handle({ type: 'observe' })).snapshot!;
    expect(next.mutationCounter).toBeGreaterThan(0);
  });
});
