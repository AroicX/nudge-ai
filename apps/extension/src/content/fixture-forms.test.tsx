// @vitest-environment jsdom
/**
 * Local fixture coverage: the real React fixture pages (apps/fixtures) driven by
 * the real content adapter (observe → execute → read back). This is jsdom, not
 * Chrome, and not live Google Calendar — see docs/browser-agent.md.
 */
import { act, cleanup, render } from '@testing-library/react';
import { checkExpectation } from '@nudge/core';
import type { ContentResult, DomToolCall, PageSnapshot } from '@nudge/contracts';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ApplyFixture } from '../../../fixtures/src/pages/apply';
import { CalendarFixture } from '../../../fixtures/src/pages/calendar';
import { createPageAdapter } from './page-adapter';

beforeAll(() => {
  // jsdom has no layout: give rendered elements a box so visibility checks behave like Chrome.
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { x: 10, y: 20, width: 120, height: 24, top: 20, left: 10, right: 130, bottom: 44, toJSON() {} };
    },
  });
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined;
  // jsdom lacks DataTransfer and rejects constructed FileLists; Chrome supports both natively.
  // Test-only scaffolding so attachFile's real code path (items.add → input.files → change) runs.
  class FakeDataTransfer {
    #files: File[] = [];
    items = { add: (file: File) => void this.#files.push(file) };
    get files() {
      return Object.assign([...this.#files], { item: (index: number) => this.#files[index] ?? null });
    }
  }
  (window as unknown as { DataTransfer: unknown }).DataTransfer = FakeDataTransfer;
  const stored = new WeakMap<HTMLInputElement, unknown>();
  Object.defineProperty(HTMLInputElement.prototype, 'files', {
    configurable: true,
    get(this: HTMLInputElement) {
      return stored.get(this) ?? [];
    },
    set(this: HTMLInputElement, value: unknown) {
      stored.set(this, value);
    },
  });
});
afterEach(() => cleanup());

function harness() {
  const adapter = createPageAdapter({ document, window, documentId: 'doc' });
  const observe = async () => (await adapter.handle({ type: 'observe' })).snapshot as PageSnapshot;
  const run = async (call: DomToolCall): Promise<ContentResult> => {
    let result!: ContentResult;
    await act(async () => {
      result = await adapter.handle({ type: 'execute', call, documentId: 'doc', generation: 0 });
    });
    return result;
  };
  const id = async (match: (element: PageSnapshot['elements'][number]) => boolean) => {
    const found = (await observe()).elements.find(match);
    if (!found) throw new Error('element not observed');
    return found.id;
  };
  const byName = (name: string | RegExp) => id((element) => (typeof name === 'string' ? element.name === name : name.test(element.name ?? '')));
  return { adapter, observe, run, id, byName };
}

describe('job application fixture', () => {
  it('fills React-controlled fields and the page retains them', async () => {
    render(<ApplyFixture />);
    const { run, byName, observe } = harness();
    const first = await byName('First name *');
    expect(await run({ tool: 'type_text', tabId: 0, elementId: first, text: 'Ada', mode: 'replace' })).toMatchObject({ ok: true, fieldValue: 'Ada' });
    await run({ tool: 'type_text', tabId: 0, elementId: await byName('Last name *'), text: 'Lovelace', mode: 'replace' });
    await run({ tool: 'type_text', tabId: 0, elementId: await byName('Email *'), text: 'ada@example.com', mode: 'replace' });
    const snapshot = await observe();
    expect(snapshot.elements.find((element) => element.name === 'First name *')).toMatchObject({ value: 'Ada', required: true });
    expect((document.getElementById('first') as HTMLInputElement).value).toBe('Ada');
  });

  it('reports a site-reformatted phone value as retained, with the stored value', async () => {
    render(<ApplyFixture />);
    const { run, byName } = harness();
    const result = await run({ tool: 'type_text', tabId: 0, elementId: await byName('Phone *'), text: '+447700900123', mode: 'replace' });
    expect(result).toMatchObject({ ok: true, fieldValue: '+44 7700 900123' });
    expect(result.detail).toMatch(/reformatted/);
  });

  it('picks autocomplete and custom-dropdown options and verifies the displayed value', async () => {
    render(<ApplyFixture />);
    const { run, byName, id, observe } = harness();
    const location = await byName('Location *');
    expect((await observe()).elements.find((element) => element.id === location)?.kind).toBe('combobox');
    const chosen = await run({ tool: 'choose_option', tabId: 0, elementId: location, value: 'London, UK', query: 'Lon' });
    expect(chosen).toMatchObject({ ok: true, fieldValue: 'London, UK' });
    const years = await id((element) => element.kind === 'button' && element.name === 'Years of experience *');
    expect(await run({ tool: 'choose_option', tabId: 0, elementId: years, value: '3–5 years' })).toMatchObject({ ok: true });
    expect((await observe()).elements.find((element) => element.id === years)?.text).toBe('3–5 years');
    const missing = await run({ tool: 'choose_option', tabId: 0, elementId: years, value: '25 years' });
    expect(missing).toMatchObject({ ok: false, errorCategory: 'not_found' });
    expect(missing.options).toContain('10+ years');
  });

  it('shows validation for a required declaration that must be asked, then attaches the CV and continues to step 2', async () => {
    render(<ApplyFixture />);
    const { run, byName, id, observe, adapter } = harness();
    for (const [name, text] of [['First name *', 'Ada'], ['Last name *', 'Lovelace'], ['Email *', 'ada@example.com'], ['Phone *', '+447700900123']] as const)
      await run({ tool: 'type_text', tabId: 0, elementId: await byName(name), text, mode: 'replace' });
    await run({ tool: 'choose_option', tabId: 0, elementId: await byName('Location *'), value: 'London, UK', query: 'Lon' });
    await run({ tool: 'choose_option', tabId: 0, elementId: await id((element) => element.name === 'Years of experience *'), value: '6–10 years' });
    await run({ tool: 'click', tabId: 0, elementId: await byName('Next') });
    let snapshot = await observe();
    expect(snapshot.validation).toEqual(expect.arrayContaining(['Answer the work authorization question.', 'Upload your CV.']));
    const yes = snapshot.elements.find((element) => element.inputType === 'radio' && element.label === 'Yes');
    expect(yes?.description).toMatch(/Group: Are you legally authorized/);
    // The hidden file input behind "Upload CV" is still a target.
    const upload = snapshot.elements.find((element) => element.kind === 'file');
    expect(upload).toBeDefined();
    let attached!: ContentResult;
    await act(async () => {
      attached = await adapter.handle({
        type: 'attach_file',
        elementId: upload!.id,
        documentId: 'doc',
        generation: 0,
        file: { name: 'Ada-CV.pdf', mime: 'application/pdf', base64: btoa('%PDF-1.4 fixture') },
      });
    });
    expect(attached).toMatchObject({ ok: true, fieldValue: 'Ada-CV.pdf' });
    expect(attached.detail).toMatch(/page shows it/);
    // The user answered the declaration; only then is it chosen.
    await run({ tool: 'choose_option', tabId: 0, elementId: yes!.id, value: 'Yes' });
    await run({ tool: 'click', tabId: 0, elementId: await byName('Next') });
    snapshot = await observe();
    expect(snapshot.elements.some((element) => element.kind === 'textarea')).toBe(true);
    expect(snapshot.elements.some((element) => element.name === 'Submit application')).toBe(true);
    expect(snapshot.text.join(' ')).not.toMatch(/Application submitted/);
  });

  it('rejects an unsupported upload type before touching the field', async () => {
    render(<ApplyFixture />);
    const { observe, adapter } = harness();
    const upload = (await observe()).elements.find((element) => element.kind === 'file')!;
    const result = await adapter.handle({
      type: 'attach_file',
      elementId: upload.id,
      documentId: 'doc',
      generation: 0,
      file: { name: 'photo.png', mime: 'image/png', base64: btoa('png') },
    });
    expect(result).toMatchObject({ ok: false, errorCategory: 'value_rejected' });
  });
});

describe('calendar-style fixture', () => {
  it('keeps Create and the newly opened editor dialog in view despite a huge grid, and verifies the click', async () => {
    render(<CalendarFixture />);
    const { run, byName, observe } = harness();
    const before = await observe();
    expect(before.elements.some((element) => element.name === 'Create')).toBe(true);
    const click = await run({ tool: 'click', tabId: 0, elementId: await byName('Create') });
    const after = await observe();
    expect(after.dialog?.name).toBe('Event details');
    expect(after.elements[0]?.inDialog).toBe(true);
    expect(after.elements.find((element) => element.name === 'Add title')).toMatchObject({ inDialog: true });
    expect(checkExpectation({ kind: 'count_changed' }, before, after, click)).toMatchObject({ verified: true, evidence: expect.stringMatching(/dialog opened/i) });
  });

  it('fills title, picks a time slot from the combobox and rejects an unparseable date', async () => {
    render(<CalendarFixture />);
    const { run, byName, observe } = harness();
    await run({ tool: 'click', tabId: 0, elementId: await byName('Create') });
    await run({ tool: 'type_text', tabId: 0, elementId: await byName('Add title'), text: 'Design review', mode: 'replace' });
    const time = await run({ tool: 'choose_option', tabId: 0, elementId: await byName('Start time'), value: '9:00am', query: '9:' });
    expect(time).toMatchObject({ ok: true, fieldValue: '9:00am' });
    const badDate = await run({ tool: 'type_text', tabId: 0, elementId: await byName('Start date'), text: 'tomorrow', mode: 'replace' });
    expect(badDate).toMatchObject({ ok: false, errorCategory: 'value_rejected', fieldValue: 'Mon, 19 Oct 2026' });
    const goodDate = await run({ tool: 'type_text', tabId: 0, elementId: await byName('Start date'), text: 'Tue, 20 Oct 2026', mode: 'replace' });
    expect(goodDate).toMatchObject({ ok: true, fieldValue: 'Tue, 20 Oct 2026' });
    expect((await observe()).elements.find((element) => element.name === 'Add title')?.value).toBe('Design review');
  });

  it('marks references stale after the dialog closes', async () => {
    render(<CalendarFixture />);
    const { run, byName } = harness();
    await run({ tool: 'click', tabId: 0, elementId: await byName('Create') });
    const title = await byName('Add title');
    await run({ tool: 'click', tabId: 0, elementId: await byName('Cancel') });
    expect(await run({ tool: 'type_text', tabId: 0, elementId: title, text: 'x', mode: 'replace' })).toMatchObject({ ok: false, errorCategory: 'stale_element' });
  });

  it('a slow save still creates exactly one event (the agent must look it up instead of re-saving)', async () => {
    render(<CalendarFixture slowSaveMs={400} />);
    const { run, byName, observe } = harness();
    await run({ tool: 'click', tabId: 0, elementId: await byName('Create') });
    await run({ tool: 'type_text', tabId: 0, elementId: await byName('Add title'), text: 'Design review', mode: 'replace' });
    await run({ tool: 'click', tabId: 0, elementId: await byName('Save') });
    expect((await observe()).elements.some((element) => element.name === 'Saving…')).toBe(true);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 500)));
    const events = (await observe()).elements.filter((element) => /Design review/.test(element.name ?? ''));
    expect(events).toHaveLength(1);
  });
});
