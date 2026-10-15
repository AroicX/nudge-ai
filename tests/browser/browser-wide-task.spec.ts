import { expect, test } from '@playwright/test';

test('mail can be reused across tabs and verification input does not submit itself', async ({ context, page }) => {
  await page.goto('/verification');
  const mail = await context.newPage();
  await mail.goto('/mail');
  await expect(mail.getByRole('heading', { name: 'Your verification code' })).toBeVisible();
  await expect(mail.getByText('482913')).toBeVisible();

  await page.bringToFront();
  await page.getByLabel('One-time code').fill('482913');
  await expect(page.getByText('Input length: 6')).toBeVisible();
  await expect(page.getByText('Submitted: no')).toBeVisible();
});

test('mail fixture distinguishes the payment reminder from OTP mail', async ({ page }) => {
  await page.goto('/mail');
  await expect(page.getByRole('heading', { name: 'Your payment method expires soon' })).toBeVisible();
  await expect(page.locator('[data-received-at]')).toHaveCount(2);
});
