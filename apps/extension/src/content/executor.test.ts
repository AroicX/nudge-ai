// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPageAdapter } from './page-adapter';

function visible(element: Element): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 }),
  });
}

describe('PageAdapter execution', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('rejects a stale document-scoped element ID', async () => {
    document.body.innerHTML = '<button>Go</button>';
    visible(document.querySelector('button')!);
    const adapter = createPageAdapter({ document, window, documentId: 'doc_2' });

    await expect(
      adapter.execute(
        { type: 'click', elementId: 'doc_1:1' },
        { active: true, documentId: 'doc_2' },
      ),
    ).resolves.toMatchObject({ ok: false, detail: expect.stringContaining('stale') });
  });

  it.each([
    ['removed', '<button>Go</button>', (button: HTMLButtonElement) => button.remove()],
    [
      'hidden',
      '<button>Go</button>',
      (button: HTMLButtonElement) => (button.style.display = 'none'),
    ],
    ['disabled', '<button disabled>Go</button>', () => undefined],
  ])('refuses a %s click target', async (_name, markup, mutate) => {
    document.body.innerHTML = markup;
    const button = document.querySelector('button') as HTMLButtonElement;
    visible(button);
    const adapter = createPageAdapter({ document, window, documentId: 'doc_1' });
    const snapshot = await adapter.observe();
    mutate(button);

    const result = await adapter.execute(
      { type: 'click', elementId: snapshot.elements[0]!.id },
      { active: true, documentId: 'doc_1' },
    );

    expect(result.ok).toBe(false);
  });

  it('supports replace and append while dispatching native input and change events', async () => {
    document.body.innerHTML = '<input aria-label="Name" value="A" />';
    const input = document.querySelector('input')!;
    visible(input);
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    const adapter = createPageAdapter({ document, window, documentId: 'doc_1' });
    const snapshot = await adapter.observe();
    const elementId = snapshot.elements[0]!.id;

    await adapter.execute(
      { type: 'type_text', elementId, text: 'Ada', mode: 'replace' },
      { active: true, documentId: 'doc_1' },
    );
    await adapter.execute(
      { type: 'type_text', elementId, text: ' Lovelace', mode: 'append' },
      { active: true, documentId: 'doc_1' },
    );

    expect(input.value).toBe('Ada Lovelace');
    expect(events).toEqual(['input', 'change', 'input', 'change']);
  });

  it('uses the native value setter so framework-controlled inputs observe the update', async () => {
    document.body.innerHTML = '<input aria-label="Name" />';
    const input = document.querySelector('input')!;
    visible(input);
    const setter = vi.spyOn(HTMLInputElement.prototype, 'value', 'set');
    const adapter = createPageAdapter({ document, window, documentId: 'doc_1' });
    const snapshot = await adapter.observe();

    await adapter.execute(
      { type: 'type_text', elementId: snapshot.elements[0]!.id, text: 'Ada', mode: 'replace' },
      { active: true, documentId: 'doc_1' },
    );

    expect(setter).toHaveBeenCalled();
    setter.mockRestore();
  });

  it('allows navigation only to a URL observed from the referenced link', async () => {
    document.body.innerHTML = '<a href="/contact">Contact</a>';
    visible(document.querySelector('a')!);
    const navigate = vi.fn();
    const adapter = createPageAdapter({ document, window, documentId: 'doc_1', navigate });
    const snapshot = await adapter.observe();
    const sourceElementId = snapshot.elements[0]!.id;
    const observedUrl = (document.querySelector('a') as HTMLAnchorElement).href;

    const blocked = await adapter.execute(
      { type: 'navigate_to_observed_url', url: 'https://attacker.example/', sourceElementId },
      { active: true, documentId: 'doc_1' },
    );
    const allowed = await adapter.execute(
      { type: 'navigate_to_observed_url', url: observedUrl, sourceElementId },
      { active: true, documentId: 'doc_1' },
    );

    expect(blocked.ok).toBe(false);
    expect(allowed.ok).toBe(true);
    expect(navigate).toHaveBeenCalledWith(observedUrl);
  });

  it('reports no change after a bounded timeout', async () => {
    vi.useFakeTimers();
    const adapter = createPageAdapter({ document, window, documentId: 'doc_1' });
    const pending = adapter.waitForChange(window.location.href, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({ changed: false, reason: 'timeout' });
    vi.useRealTimers();
  });
});
