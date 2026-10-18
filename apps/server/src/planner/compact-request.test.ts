import { describe, expect, it } from 'vitest';

import { MAX_LOCAL_REQUEST_BYTES, serializeCompactPlannerRequest } from './compact-request';
import { plannerRequest } from './test-fixtures';

describe('compact local planner request', () => {
  it('bounds a dense page and keeps goal matches, controls, current tab and safety without mutating input', () => {
    const request = plannerRequest();
    request.goal = 'Find a black iPhone on Jumia';
    request.memory.constraints = [
      { text: 'Never purchase or submit a payment.', instructionVersion: 1 },
    ];
    request.authorization.exclusions = ['Do not buy anything'];
    const snapshot = request.observation!.snapshot;
    snapshot.elements = Array.from({ length: 248 }, (_, i) => ({
      id: `${snapshot.documentId}:${i}`,
      kind: 'link',
      name: 'Unrelated catalog item '.repeat(20),
      text: 'Unrelated description '.repeat(40),
      href: `https://jumia.com.ng/item/${i}`,
      visible: true,
      disabled: false,
    }));
    snapshot.elements.push({
      id: `${snapshot.documentId}:248`,
      kind: 'input',
      name: 'Search products',
      inputType: 'search',
      visible: true,
      disabled: false,
    });
    snapshot.elements.push({
      id: `${snapshot.documentId}:249`,
      kind: 'link',
      name: 'Black iPhone 15',
      href: 'https://jumia.com.ng/black-iphone',
      visible: true,
      disabled: false,
    });
    snapshot.text = Array.from({ length: 199 }, () => 'Unrelated catalog copy '.repeat(90));
    snapshot.text.push('Black iPhone 15: ₦700,000');
    request.tabs = Array.from({ length: 99 }, (_, i) => ({
      ...request.tabs[0]!,
      tabId: i + 100,
      title: 'Other tab '.repeat(50),
      url: `https://other.test/${i}`,
    }));
    request.tabs.push({
      ...request.tabs[0]!,
      tabId: request.observation!.tabId,
      url: snapshot.url,
    });
    const before = structuredClone(request);
    const serialized = serializeCompactPlannerRequest(request);
    const compact = JSON.parse(serialized);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(MAX_LOCAL_REQUEST_BYTES);
    expect(
      compact.observation.snapshot.elements.map((element: { id: string }) => element.id),
    ).toEqual(expect.arrayContaining([`${snapshot.documentId}:248`, `${snapshot.documentId}:249`]));
    expect(compact.observation.snapshot.text).toContain('Black iPhone 15: ₦700,000');
    expect(compact.observation.snapshot.url).toBe(snapshot.url);
    expect(
      compact.tabs.some((tab: { tabId: number }) => tab.tabId === request.observation!.tabId),
    ).toBe(true);
    expect(compact.authorization).toEqual(request.authorization);
    expect(compact.memory.constraints).toEqual(request.memory.constraints);
    expect(compact.observation.snapshot.truncated).toBe(true);
    expect(compact.contextNotice).toMatch(/omitted.*absence/i);
    expect(request).toEqual(before);
  });

  it('refuses to silently cut essential authorization or user constraints', () => {
    const request = plannerRequest();
    request.memory.constraints = Array.from({ length: 30 }, () => ({
      text: 'Never send these confidential records. '.repeat(40),
      instructionVersion: 1,
    }));
    expect(() => serializeCompactPlannerRequest(request)).toThrow(
      /authorization.*constraints.*budget/i,
    );
  });

  it('preserves safety notes, failed and uncertain steps when compacting history', () => {
    const request = plannerRequest();
    request.notes = ['Do not repeat a send whose result is uncertain.'];
    request.memory.steps = [
      { tool: 'click', summary: 'Possibly sent', ok: false, uncertain: true },
      ...Array.from({ length: 50 }, () => ({
        tool: 'read_text',
        summary: 'Read item '.repeat(100),
        ok: true,
      })),
    ];
    const compact = JSON.parse(serializeCompactPlannerRequest(request));
    expect(compact.notes).toEqual(expect.arrayContaining(request.notes));
    expect(compact.notes.join(' ')).toMatch(/omitted.*absence/);
    expect(compact.memory.steps).toContainEqual(request.memory.steps[0]);
  });
});
