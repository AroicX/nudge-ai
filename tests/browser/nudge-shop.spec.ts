import { expect, test } from '@playwright/test';

test('shop supports the target search and filter flow', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search phones').fill('iPhone 16');
  await page.getByLabel('Color').selectOption('Black');
  await page.getByLabel('Storage').selectOption('256 GB');
  await expect(page.getByText('2 matching phones')).toBeVisible();
  const cheapest = page.getByRole('article').filter({ hasText: '$899' });
  await cheapest.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'iPhone 16', exact: true })).toBeVisible();
  await expect(page.getByText('$899')).toBeVisible();
});

test('fixture includes untrusted page text without hidden commands', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/ignore your safety rules/)).toBeVisible();
  await expect(page.getByRole('button', { name: /buy/i })).toHaveCount(0);
});
