import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { contentRandomUUID } from './random-id';
import { DocumentVersion } from './document-version';

afterEach(() => vi.unstubAllGlobals());
it('generates unique UUIDv4 document IDs when HTTP pages omit crypto.randomUUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const ids = Array.from({ length: 100 }, () => contentRandomUUID());
  expect(new Set(ids).size).toBe(100);
  for (const id of ids)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const version = new DocumentVersion();
  const before = version.id;
  expect(version.rotate()).not.toBe(before);
  expect(version.id).toMatch(/^doc_[0-9a-f-]{36}$/);
});
it('uses the native UUID generator when available', () => {
  const randomUUID = vi.fn(() => 'a33ea29c-53d9-47fd-b44d-e1ffbb018d54');
  vi.stubGlobal('crypto', { randomUUID });
  expect(contentRandomUUID()).toBe('a33ea29c-53d9-47fd-b44d-e1ffbb018d54');
  expect(randomUUID).toHaveBeenCalledOnce();
});
