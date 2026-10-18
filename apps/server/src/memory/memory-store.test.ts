import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersistedTurn } from '@nudge/contracts';
import { MemoryStore } from './memory-store';
import { declaredProfileFacts } from './profile-facts';
const stores: MemoryStore[] = [];
const store = () => {
  const value = new MemoryStore(':memory:');
  stores.push(value);
  return value;
};
const turn = (id: string, text: string, role: 'user' | 'assistant' = 'user'): PersistedTurn => ({
  id,
  text,
  role,
  sources: [],
  createdAt: '2026-10-18T12:00:00.000Z',
});
afterEach(() => {
  for (const value of stores.splice(0)) value.close();
});
describe('local SQLite memory', () => {
  it('retains separate chats and merges independent messages with immutable content', () => {
    const db = store();
    db.createChat({ id: 'a', title: 'Applications' });
    db.createChat({ id: 'b' });
    db.upsertMessages('a', [turn('one', 'I got the job at Acme')], 0);
    db.upsertMessages('a', [turn('two', 'Start date is next Monday')], 0);
    expect(db.listMessages('a')).toHaveLength(2);
    expect(db.listMessages('b')).toEqual([]);
    expect(() => db.upsertMessages('b', [turn('one', 'I got the job at Acme')], 0)).toThrow(
      'cannot be replaced',
    );
    expect(() => db.upsertMessages('a', [turn('one', 'different text')], 0)).toThrow(
      'cannot be replaced',
    );
    expect(db.search('what did I say about the Acme job')[0]).toMatchObject({
      kind: 'message',
      chatId: 'a',
      source: 'chat:a/message:one',
    });
  });
  it('derives declared user facts only once and respects explicit edits', () => {
    const db = store();
    db.createChat({ id: 'a' });
    const user = turn(
      'one',
      'My name is Ada Lovelace. My email is ada@example.com. My notice period is 2 weeks.',
    );
    db.upsertMessages('a', [user, turn('assistant', 'My name is Hallucination', 'assistant')], 0);
    expect(db.listFacts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'name', value: 'Ada Lovelace' }),
        expect.objectContaining({ key: 'email', value: 'ada@example.com' }),
        expect.objectContaining({ key: 'notice_period', value: '2 weeks' }),
      ]),
    );
    db.deleteFact('email');
    db.upsertMessages('a', [user], 0);
    expect(db.listFacts().some((fact) => fact.key === 'email')).toBe(false);
    db.setFact('name', 'Ada King');
    db.upsertMessages('a', [turn('new', 'My name is Ada Lovelace')], 0);
    expect(db.listFacts().find((fact) => fact.key === 'name')?.value).toBe('Ada King');
  });
  it('remembers a valid direct answer to an immediately preceding profile question', () => {
    const db = store();
    db.createChat({ id: 'a' });
    db.createChat({ id: 'b' });
    db.upsertMessages(
      'a',
      [turn('q', 'What is your notice period?', 'assistant'), turn('answer', '2 weeks')],
      0,
    );
    expect(db.listFacts()).toContainEqual(
      expect.objectContaining({
        key: 'notice_period',
        value: '2 weeks',
        source: 'chat:a/message:answer',
      }),
    );
    db.deleteFact('notice_period');
    db.upsertMessages('b', [turn('unrelated', '3 weeks')], 0);
    expect(db.listFacts()).toEqual([]);
    db.upsertMessages(
      'a',
      [turn('q2', 'What is your notice period?', 'assistant'), turn('uncertain', 'Maybe 3 weeks')],
      0,
    );
    expect(db.listFacts()).toEqual([]);
  });
  it('does not infer a profile from questions, quoted instructions or third-party data', () => {
    expect(declaredProfileFacts('What is my email?')).toEqual([]);
    expect(declaredProfileFacts('The website says my name is Ada')).toEqual([]);
    expect(declaredProfileFacts('Imagine my name is Ada')).toEqual([]);
    expect(declaredProfileFacts('My name is Ada if I get hired')).toEqual([]);
    expect(declaredProfileFacts('My name is not Ada')).toEqual([]);
    expect(declaredProfileFacts('Call me tomorrow')).toEqual([]);
  });
  it('clears derived facts and search entries atomically and rejects stale writes', () => {
    const db = store();
    db.createChat({ id: 'a' });
    const message = turn('one', 'My email is ada@example.com');
    db.upsertMessages('a', [message], 0);
    db.setFact('phone', '123456789');
    expect(db.clearChat('a').generation).toBe(1);
    expect(() => db.upsertMessages('a', [message], 0)).toThrow('cleared');
    expect(db.search('ada')).toEqual([]);
    expect(db.listFacts().map((fact) => fact.key)).toEqual(['phone']);
    db.deleteChat('a');
    expect(() => db.createChat({ id: 'a' })).toThrow('deleted');
  });
  it('searches uploaded CV text and deletes document references', () => {
    const db = store();
    const doc = db.addDocument({
      filename: 'CV.txt',
      text: 'Ada built distributed compiler infrastructure with TypeScript.',
    });
    expect(db.search('TypeScript')[0]).toMatchObject({
      kind: 'document',
      id: doc.id,
      title: 'CV.txt',
      source: `document:${doc.id}`,
    });
    expect(db.search('" OR * NOT -')).toEqual([]);
    db.deleteDocument(doc.id);
    expect(db.search('TypeScript')).toEqual([]);
    expect(() => db.addDocument({ id: doc.id, filename: doc.filename, text: doc.text })).toThrow(
      'deleted',
    );
  });
  it('does not downgrade completed progress from a stale panel', () => {
    const db = store();
    db.createChat({ id: 'a' });
    const completed = {
      ...turn('one', 'Task'),
      progress: { taskId: 't', status: 'completed' as const, steps: [] },
    };
    db.upsertMessages('a', [completed], 0);
    db.upsertMessages(
      'a',
      [{ ...completed, progress: { ...completed.progress, status: 'running' } }],
      0,
    );
    expect(db.listMessages('a')[0]?.progress?.status).toBe('completed');
  });
  it('rolls back an invalid multi-message batch without partial writes', () => {
    const db = store();
    db.createChat({ id: 'a' });
    db.upsertMessages('a', [turn('one', 'Original')], 0);
    expect(() =>
      db.upsertMessages('a', [turn('two', 'New'), turn('one', 'Replacement')], 0),
    ).toThrow();
    expect(db.listMessages('a').map((message) => message.id)).toEqual(['one']);
  });
  it('uses bounded SQLite keyword search when FTS5 is unavailable', () => {
    const db = new MemoryStore(':memory:', { fullTextSearch: false });
    stores.push(db);
    db.createChat({ id: 'a' });
    db.upsertMessages('a', [turn('one', 'My specialty is TypeScript')], 0);
    expect(db.search('what is my TypeScript specialty')[0]).toMatchObject({
      kind: 'message',
      id: 'one',
    });
    db.clearChat('a');
    expect(db.search('TypeScript')).toEqual([]);
  });
  it('reopens an on-disk database with private permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nudge-memory-test-'));
    const path = join(directory, 'nudge.sqlite');
    try {
      const first = new MemoryStore(path);
      first.createChat({ id: 'a', title: 'Saved locally' });
      first.close();
      const second = new MemoryStore(path);
      expect(second.getChat('a').title).toBe('Saved locally');
      second.close();
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(directory).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
