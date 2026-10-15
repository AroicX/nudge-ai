import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('built extension requests browser-wide tab access without password permissions', async () => {
  const manifest = JSON.parse(
    await readFile('apps/extension/.output/chrome-mv3/manifest.json', 'utf8'),
  ) as { permissions: string[]; host_permissions: string[] };
  expect(manifest.permissions).toContain('tabs');
  expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(JSON.stringify(manifest)).not.toMatch(/passwords|clipboardRead/);
});
