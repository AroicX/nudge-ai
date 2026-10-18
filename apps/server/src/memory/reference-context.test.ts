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
