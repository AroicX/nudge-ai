import type { AuthorizationRecord } from '@nudge/contracts';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { toCsv, toXlsx } from './export';
import { RecordStore, groundRecord, normalizeUrl } from './records';
import { validateTimedRepeat } from './timed';

const evidence = {
  texts: ['Senior Frontend Engineer — Acme & Co — Remote', 'Apply now'],
  hrefs: ['https://jobs.test/a/1?utm_source=x'],
  values: [],
};

describe('records', () => {
  it('normalizes tracking params and fragments', () => {
    expect(normalizeUrl('https://Jobs.Example.com/a/?utm_source=x&id=3&gclid=9#top')).toBe('https://jobs.example.com/a?id=3');
  });

  it('turns ungrounded fields into unknown', () => {
    expect(
      groundRecord({ title: 'Senior Frontend Engineer', salary: '$200k', url: 'https://jobs.test/a/1' }, evidence),
    ).toEqual({ title: 'Senior Frontend Engineer', salary: 'unknown', url: 'https://jobs.test/a/1' });
  });

  it('dedupes by normalized url and tracks unsaved records', () => {
    const store = new RecordStore(['title', 'company']);
    const first = store.add({ fields: { title: 'Senior Frontend Engineer', company: 'Acme & Co' }, sourceUrl: 'https://jobs.test/a/1?utm_source=x', observedAt: '2026-10-15T18:00:00.000Z' }, evidence);
    const again = store.add({ fields: { title: 'Senior Frontend Engineer', company: 'Acme & Co' }, sourceUrl: 'https://jobs.test/a/1', observedAt: '2026-10-15T18:01:00.000Z' }, evidence);
    expect(first.added).toBe(true);
    expect(again.added).toBe(false);
    expect(store.list()).toHaveLength(1);
    store.markSaved(first.record.id, { tabId: 3, rowHint: 'row 2', verifiedAt: '2026-10-15T18:02:00.000Z' });
    expect(store.unsaved()).toHaveLength(0);
    expect(RecordStore.from(store.toJSON()).list()).toHaveLength(1);
  });
});

describe('export', () => {
  const store = new RecordStore(['title', 'note']);
  store.add({ fields: { title: 'Acme & Co', note: '=HYPERLINK("x")' }, sourceUrl: 'https://jobs.test/a/1', observedAt: '2026-10-15T18:00:00.000Z' }, {
    texts: ['Acme & Co', '=HYPERLINK("x")'], hrefs: [], values: [],
  });
  store.add({ fields: { title: '-1', note: 'ok' }, sourceUrl: 'https://jobs.test/a/2', observedAt: '2026-10-15T18:00:00.000Z' }, {
    texts: ['-1', 'ok'], hrefs: [], values: [],
  });

  it('escapes formula injection in CSV', () => {
    const csv = toCsv(['title', 'note'], store.list());
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain("'-1");
    expect(csv.split('\r\n')[0]).toBe('title,note,sourceUrl,observedAt');
  });

  it('builds a valid xlsx zip with inline strings', () => {
    const files = unzipSync(toXlsx(['title', 'note'], store.list()));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('<is><t>Acme &amp; Co</t></is>');
    expect(sheet).toContain("<is><t>'=HYPERLINK(&quot;x&quot;)</t></is>");
  });
});

describe('validateTimedRepeat', () => {
  const authorization: AuthorizationRecord = { taskId: 't', instruction: 'x', origins: 'browse_web', categories: ['read', 'navigate'], destinations: [], exclusions: [], limits: {} };
  const base = { tool: 'start_timed_repeat' as const, tabId: 1, intervalMs: 3000, maxDurationMs: 600000, action: { kind: 'scroll' as const, direction: 'down' as const, amount: 'viewport' as const } };

  it('accepts scrolling every 3 seconds', () => {
    expect(validateTimedRepeat(base, { authorization, tabOrigin: 'https://x.test' })).toEqual({ ok: true });
  });
  it('rejects too-fast intervals and unknown keys', () => {
    expect(validateTimedRepeat({ ...base, intervalMs: 500 }, { authorization, tabOrigin: 'https://x.test' }).ok).toBe(false);
    expect(
      validateTimedRepeat({ ...base, action: { kind: 'press_keys', keys: ['Enter'] } }, { authorization, tabOrigin: 'https://x.test' }).ok,
    ).toBe(false);
  });
  it('rejects a tab outside the authorized origins', () => {
    expect(
      validateTimedRepeat(base, { authorization: { ...authorization, origins: ['https://other.test'] }, tabOrigin: 'https://x.test' }).ok,
    ).toBe(false);
  });
});
