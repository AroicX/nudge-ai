// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { createPageAdapter } from './page-adapter';

function visible(element: Element, rect = { x: 10, y: 20, width: 120, height: 32 }): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    }),
  });
}

describe('PageAdapter.observe', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/products');
  });

  it('extracts visible accessible controls, labels, disabled state, and select options', async () => {
    document.body.innerHTML = `
      <h1>Phones</h1>
      <label for="query">Search products</label>
      <input id="query" />
      <button aria-label="Apply filters" disabled>Apply</button>
      <select aria-label="Storage"><option>128 GB</option><option selected>256 GB</option></select>
      <button id="hidden" style="display:none">Hidden</button>
    `;
    document
      .querySelectorAll('h1,input,button:not(#hidden),select')
      .forEach((element) => visible(element));

    const snapshot = await createPageAdapter({ document, window, documentId: 'doc_1' }).observe();

    expect(snapshot.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'heading', name: 'Phones', visible: true }),
        expect.objectContaining({ kind: 'input', label: 'Search products', visible: true }),
        expect.objectContaining({ kind: 'button', name: 'Apply filters', disabled: true }),
        expect.objectContaining({
          kind: 'select',
          name: 'Storage',
          options: ['128 GB', '256 GB'],
          value: '256 GB',
        }),
      ]),
    );
    expect(snapshot.elements.some((element) => element.name === 'Hidden')).toBe(false);
  });

  it('records viewport position and bounded truncation', async () => {
    document.body.innerHTML = Array.from(
      { length: 260 },
      (_, index) => `<button>Item ${index}</button>`,
    ).join('');
    document.querySelectorAll('button').forEach((element) => visible(element));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 12 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });

    const snapshot = await createPageAdapter({ document, window, documentId: 'doc_1' }).observe();

    expect(snapshot.elements).toHaveLength(250);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.viewport).toMatchObject({
      width: 1440,
      height: 900,
      scrollX: 12,
      scrollY: 240,
    });
  });

  it('bounds long page text before sending a provider request', async () => {
    document.body.innerHTML = `<main>${'Very long storefront content. '.repeat(200)}</main>`;
    visible(document.querySelector('main')!);

    const snapshot = await createPageAdapter({ document, window, documentId: 'doc_1' }).observe();

    expect(snapshot.text[0]).toHaveLength(2_000);
  });

  it('exposes password and one-time-code fields only as value-less targets and excludes card fields', async () => {
    document.body.innerHTML = `
      <div data-nudge-root><button>Nudge internal</button></div>
      <input type="password" value="secret" />
      <input autocomplete="one-time-code" value="123456" />
      <input autocomplete="cc-number" value="4111111111111111" />
      <input aria-label="Display name" value="Ada" />
    `;
    document.querySelectorAll('button,input').forEach((element) => visible(element));

    const snapshot = await createPageAdapter({ document, window, documentId: 'doc_1' }).observe();

    expect(snapshot.elements).toHaveLength(3);
    expect(snapshot.elements[0]).toMatchObject({ inputType: 'password' });
    expect(snapshot.elements[0]).not.toHaveProperty('value');
    expect(snapshot.elements[1]).not.toHaveProperty('value');
    expect(snapshot.elements[2]).toMatchObject({ name: 'Display name', value: 'Ada' });
    expect(JSON.stringify(snapshot)).not.toContain('123456');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('4111111111111111');
  });
});
