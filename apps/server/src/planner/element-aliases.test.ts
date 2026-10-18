import { ElementIdSchema } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';
import { aliasPlannerElements } from './element-aliases';
import { plannerRequest } from './test-fixtures';

describe('local planner element aliases', () => {
  it('shortens only observed element identities and preserves user text and authorization', () => {
    const source = plannerRequest();
    source.goal = 'doc_1:1';
    source.authorization.instruction = 'doc_1:1';
    source.authorization.exclusions = ['local:1'];
    source.memory.userData = [{ label: 'elementId', value: 'doc_1:1' }];
    source.notes = ['doc_1:1'];
    source.observation!.snapshot.elements[0]!.text = 'doc_1:1';
    source.observation!.snapshot.elements[0]!.value = 'local:1';
    const before = structuredClone(source);
    const { request } = aliasPlannerElements(source);
    expect(request.observation!.snapshot.elements.map((element) => element.id)).toEqual([
      'local:1',
      'local:2',
    ]);
    for (const element of request.observation!.snapshot.elements)
      expect(ElementIdSchema.safeParse(element.id).success).toBe(true);
    const expected = structuredClone(before);
    expected.observation!.snapshot.elements[0]!.id = 'local:1';
    expected.observation!.snapshot.elements[1]!.id = 'local:2';
    expect(request).toEqual(expected);
    expect(source).toEqual(before);
  });

  it.each(['elementId', 'fromElementId', 'toElementId', 'destinationElementId', 'sourceElementId'])(
    'restores %s and value_equals without rewriting literal text',
    (key) => {
      const { restore } = aliasPlannerElements(plannerRequest());
      const response = {
        requestId: 'local:1',
        toolCall: { tool: 'type_text', [key]: 'local:1', text: 'local:1', value: 'local:2' },
        expectation: { kind: 'value_equals', elementId: 'local:2', value: 'local:1' },
      };
      const before = structuredClone(response);
      expect(restore(response)).toEqual({
        ...response,
        toolCall: { ...response.toolCall, [key]: 'doc_1:1' },
        expectation: { ...response.expectation, elementId: 'doc_1:2' },
      });
      expect(response).toEqual(before);
    },
  );

  it('leaves unknown and stale identities unchanged for controller validation', () => {
    const { restore } = aliasPlannerElements(plannerRequest());
    const response = {
      toolCall: { fromElementId: 'local:999', toElementId: 'old-document:1' },
      expectation: { elementId: 'missing:3', value: 'local:1' },
    };
    expect(restore(response)).toEqual(response);
  });

  it('preserves arbitrary record fields even if their names and values resemble identities', () => {
    const { restore } = aliasPlannerElements(plannerRequest());
    const response = {
      toolCall: {
        tool: 'record_items',
        records: [{ fields: { elementId: 'local:1', sourceElementId: 'local:2' } }],
      },
      authorization: { elementId: 'local:1' },
    };
    expect(restore(response)).toEqual(response);
  });

  it('keeps mappings isolated across documents and absent observations', () => {
    const first = aliasPlannerElements(plannerRequest());
    const source = plannerRequest();
    source.observation!.snapshot.documentId = 'next-document';
    source.observation!.snapshot.elements = [
      { ...source.observation!.snapshot.elements[0]!, id: 'next-document:42' },
    ];
    const second = aliasPlannerElements(source);
    const response = { toolCall: { elementId: 'local:1' } };
    expect(second.restore(response)).toEqual({ toolCall: { elementId: 'next-document:42' } });
    expect(first.restore(response)).toEqual({ toolCall: { elementId: 'doc_1:1' } });
    const empty = aliasPlannerElements(plannerRequest({ observation: null }));
    expect(empty.restore(response)).toEqual(response);
    expect(empty.restore(null)).toBeNull();
    expect(empty.restore('local:1')).toBe('local:1');
  });

  it('preserves screenshot and document identity alongside aliased DOM elements', () => {
    const source = plannerRequest();
    source.observation!.screenshot = {
      frame: {
        screenshotId: 'local:1',
        documentId: 'doc_1',
        tabId: 4,
        url: source.observation!.snapshot.url,
        capturedAt: 0,
        viewport: { cssWidth: 1200, cssHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
        imageWidth: 1200,
        imageHeight: 800,
        coordinateSpace: 'css_viewport',
        mutationCounterAtCapture: 0,
      },
      dataUrl: 'data:image/png;base64,AAAA',
    };
    const { request, restore } = aliasPlannerElements(source);
    expect(request.observation!.screenshot).toEqual(source.observation!.screenshot);
    expect(request.observation!.snapshot.documentId).toBe('doc_1');
    const response = { toolCall: { tool: 'click_at', screenshotId: 'local:1', x: 10, y: 20 } };
    expect(restore(response)).toEqual(response);
  });
});
