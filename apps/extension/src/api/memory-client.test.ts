import { afterEach, expect, it, vi } from 'vitest';
import { MemoryClient } from './memory-client';
import { ServerClient } from './server-client';
afterEach(() => vi.unstubAllGlobals());
it('does not label bodyless deletion requests as empty JSON', async () => {
  const fetcher = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetcher);
  const client = new MemoryClient('http://localhost:4317', 'paired');
  await client.deleteChat('test-chat');
  await client.clearMessages('test-chat');
  await client.deleteFact('name');
  await client.deleteDocument('doc');
  await new ServerClient('http://localhost:4317', 'paired').clearProviderKey();
  for (const call of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
    expect(call[1].method).toBe('DELETE');
    expect(call[1].body).toBeUndefined();
    expect(new Headers(call[1].headers).has('content-type')).toBe(false);
    expect(new Headers(call[1].headers).get('x-nudge-pairing-secret')).toBe('paired');
  }
});
it('keeps JSON encoding for actual preference updates', async () => {
  const fetcher = vi.fn(
    async () => new Response('{"autoRemember":false,"localDiagnostics":false}'),
  );
  vi.stubGlobal('fetch', fetcher);
  await new MemoryClient('http://localhost:4317', 'paired').savePreferences({
    autoRemember: false,
    localDiagnostics: false,
  });
  const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(call[1].headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(call[1].body as string)).toEqual({
    autoRemember: false,
    localDiagnostics: false,
  });
});
