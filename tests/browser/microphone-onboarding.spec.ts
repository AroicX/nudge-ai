import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('build contains a dedicated microphone onboarding page', async () => {
  const html = await readFile('apps/extension/.output/chrome-mv3/microphone.html', 'utf8');
  expect(html).toContain('<div id="root"></div>');
});
