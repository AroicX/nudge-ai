import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';

import { MemoryStore } from '../memory/memory-store';
import { referenceContext } from '../memory/reference-context';
import { registerProfileRoutes } from './profile';

const stores: MemoryStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function setup() {
  const app = Fastify();
  const store = new MemoryStore(':memory:');
  stores.push(store);
  registerProfileRoutes(app, {
    store,
    authenticate: async (request, reply) => {
      if (request.headers.authorization !== 'test') return reply.code(401).send({ error: 'Unauthorized' });
    },
    referenceContext: (query) => referenceContext(store, query),
  });
  return { app, store };
}
const headers = { authorization: 'test' };
const CV = 'Grace Hopper\ngrace@example.com | +1 202 555 0147 | Arlington, USA\n\nExperience\nRear Admiral, US Navy\n1943 - 1986\n\nSkills\nCOBOL, Compilers';

it('requires pairing for profile, search, file and context routes', async () => {
  const { app } = setup();
  for (const [method, url] of [
    ['GET', '/api/profile/candidate'],
    ['POST', '/api/profile/search'],
    ['GET', '/api/memory/documents/x/file'],
    ['POST', '/api/agent/context'],
  ] as const)
    expect((await app.inject(method === 'POST' ? { method, url, payload: {} } : { method, url })).statusCode).toBe(401);
});

it('uploaded CV → candidate profile → search → attachable file → default selection', async () => {
  const { app, store } = setup();
  const saved = store.addDocument({
    filename: 'Grace-CV.txt',
    text: CV,
    file: { mime: 'text/plain', bytes: Buffer.from(CV) },
  });
  const profile = (await app.inject({ url: '/api/profile/candidate', headers })).json().profile;
  expect(profile.fields.full_name.value).toBe('Grace Hopper');
  expect(profile.fields.email.value).toBe('grace@example.com');
  expect(profile.documents[0]).toMatchObject({ id: saved.id, attachable: true, looksLikeCv: true });
  const search = (
    await app.inject({ method: 'POST', url: '/api/profile/search', headers, payload: { query: 'COBOL compilers' } })
  ).json();
  expect(search.results[0].excerpt).toContain('COBOL');
  const file = (await app.inject({ url: `/api/memory/documents/${saved.id}/file`, headers })).json();
  expect(Buffer.from(file.base64, 'base64').toString()).toBe(CV);
  expect(file).toMatchObject({ filename: 'Grace-CV.txt', mime: 'text/plain' });
  const other = store.addDocument({ filename: 'Second-CV.txt', text: CV.replace('grace@', 'g.hopper@') });
  const updated = (
    await app.inject({ method: 'PUT', url: `/api/memory/documents/${other.id}/default`, headers, payload: { isDefault: true } })
  ).json().profile;
  expect(updated.selection).toBe('default');
  expect(updated.selectedDocumentId).toBe(other.id);
  const missingFile = await app.inject({ url: `/api/memory/documents/${other.id}/file`, headers });
  expect(missingFile.statusCode).toBe(404);
  expect(missingFile.json().error).toMatch(/Re-upload/);
});

it('gives other providers the same reference context, including the profile summary', async () => {
  const { app, store } = setup();
  store.addDocument({ filename: 'Grace-CV.txt', text: CV });
  const context = JSON.parse(
    (await app.inject({ method: 'POST', url: '/api/agent/context', headers, payload: { query: 'Help me complete this posting' } })).json()
      .referenceContext,
  );
  expect(context.candidateProfile.fields.email).toBe('grace@example.com');
  expect(context.references[0].text).toContain('grace@example.com');
});

it('reports a retrieval failure instead of empty context', () => {
  const broken = {
    search: () => {
      throw new Error('database is locked');
    },
    listFacts: () => [],
  };
  const context = JSON.parse(referenceContext(broken, 'Apply to this job'));
  expect(context.retrievalError).toMatch(/could not be read.*database is locked/);
  expect(context.facts).toBeUndefined();
});
