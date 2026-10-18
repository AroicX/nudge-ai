import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { MemoryStore } from '../memory/memory-store';
import { registerMemoryRoutes } from './memory';
const instances: Array<{ app: ReturnType<typeof Fastify>; store: MemoryStore }> = [];
function setup() {
  const app = Fastify();
  const store = new MemoryStore(':memory:');
  instances.push({ app, store });
  registerMemoryRoutes(app, {
    store,
    authenticate: async (request, reply) => {
      if (request.headers.authorization !== 'test')
        return reply.code(401).send({ error: 'Unauthorized' });
    },
  });
  return app;
}
afterEach(async () => {
  for (const { app, store } of instances.splice(0)) {
    await app.close();
    store.close();
  }
});
it('protects every memory operation and validates writes', async () => {
  const app = setup();
  for (const url of [
    '/api/memory/status',
    '/api/memory/chats',
    '/api/memory/facts',
    '/api/memory/documents',
    '/api/memory/search?q=name',
  ])
    expect((await app.inject({ url })).statusCode).toBe(401);
  expect(
    (await app.inject({ method: 'POST', url: '/api/memory/context', payload: { text: 'Who am I?' } }))
      .statusCode,
  ).toBe(401);
  const headers = { authorization: 'test' };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/memory/chats',
        headers,
        payload: { id: 'a', title: 'Jobs' },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/memory/chats/a/messages',
        headers,
        payload: { messages: [] },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ method: 'DELETE', url: '/api/memory/chats/a/messages', headers })).json(),
  ).toMatchObject({ generation: 1 });
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/memory/chats/a/messages',
        headers,
        payload: { messages: [], generation: 0 },
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/memory/facts/email',
        headers,
        payload: { value: 'ada@example.com' },
      })
    ).json(),
  ).toMatchObject({ fact: { key: 'email', value: 'ada@example.com' } });
  expect((await app.inject({ url: '/api/memory/chats/missing', headers })).statusCode).toBe(404);
});
