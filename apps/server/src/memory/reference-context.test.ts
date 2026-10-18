import { expect, it } from 'vitest';
import { referenceContext } from './reference-context';
const store = {
  listFacts: () => [{ key: 'name', value: 'Ada', source: 'user' }],
  search: () => [
    {
      kind: 'message',
      id: 'm',
      title: 'Old task',
      text: 'Previously filled a form',
      source: 'chat:old',
      updatedAt: 'today',
    },
    {
      kind: 'document',
      id: 'cv',
      title: 'CV',
      text: 'Relevant work experience',
      source: 'upload',
      updatedAt: 'today',
    },
  ],
};
it('keeps profile and document context while omitting unrelated old task messages for routine forms', () => {
  const context = JSON.parse(
    referenceContext(store, 'Fill this form with my profile', { includeChatHistory: false }),
  );
  expect(context.facts[0].value).toBe('Ada');
  expect(context.references.map((item: { kind: string }) => item.kind)).toEqual(['document']);
});
it('retains chat recall by default', () => {
  expect(JSON.parse(referenceContext(store, 'What did we discuss?')).references).toHaveLength(2);
});

it('includes a saved CV for an application even when search does not match the filename', () => {
  const cv = {
    listFacts: () => [{ key: 'location', value: 'London', source: 'user' }],
    search: () => [],
    listDocuments: () => [
      {
        id: 'cv',
        filename: 'Gabriel-CV.pdf',
        text: `${'Experience '.repeat(40)}Email gabriel@example.com`,
        source: 'upload',
        createdAt: 'today',
      },
    ],
  };
  const context = JSON.parse(referenceContext(cv, 'Complete the form on this page'));
  expect(context.references[0].title).toBe('Gabriel-CV.pdf');
  expect(context.references[0].text).toContain('gabriel@example.com');
  expect(context.facts[0].value).toBe('London');
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(4000);
});
