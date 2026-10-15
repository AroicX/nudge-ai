import type { ActionResult, PageSnapshot } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { verifyOutcome } from './verify';

const page = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  snapshotId: 'snap_1',
  documentId: 'doc_1',
  capturedAt: '2026-10-15T18:00:00.000Z',
  url: 'https://example.test/products',
  title: 'Products',
  viewport: { width: 1200, height: 800, scrollX: 0, scrollY: 0, pageHeight: 1600 },
  elements: [],
  text: ['Products'],
  truncated: false,
  inaccessible: [],
  ...overrides,
});

const result = (overrides: Partial<ActionResult> = {}): ActionResult => ({
  ok: true,
  actionType: 'click',
  documentId: 'doc_1',
  changed: true,
  detail: 'changed',
  ...overrides,
});

describe('verifyOutcome', () => {
  it('rejects a click that produced no relevant change', () => {
    expect(
      verifyOutcome(
        { kind: 'page_contains', text: 'Filtered results' },
        page(),
        page({ snapshotId: 'snap_2' }),
        result({ changed: false }),
      ),
    ).toMatchObject({ verified: false, shouldStop: false });
  });

  it('verifies a framework-controlled input from the fresh read-back value', () => {
    const after = page({
      snapshotId: 'snap_2',
      elements: [
        {
          id: 'doc_1:2',
          kind: 'input',
          name: 'Display name',
          value: 'Ada',
          visible: true,
          disabled: false,
        },
      ],
    });

    expect(
      verifyOutcome(
        { kind: 'element_value', elementId: 'doc_1:2', value: 'Ada' },
        page(),
        after,
        result(),
      ),
    ).toMatchObject({ verified: true });
  });

  it('requires evidence from the fresh snapshot rather than the prior snapshot', () => {
    const before = page({ text: ['Filtered results'] });
    const after = page({ snapshotId: 'snap_2', text: ['Loading'] });

    expect(
      verifyOutcome({ kind: 'page_contains', text: 'Filtered results' }, before, after, result())
        .verified,
    ).toBe(false);
  });

  it('stops after three repeated no-progress outcomes', () => {
    expect(
      verifyOutcome(
        { kind: 'page_contains', text: 'Filtered results' },
        page(),
        page({ snapshotId: 'snap_2' }),
        result({ changed: false }),
        { repeatedActionCount: 3, noProgressCount: 3 },
      ),
    ).toMatchObject({ verified: false, shouldStop: true });
  });
});
