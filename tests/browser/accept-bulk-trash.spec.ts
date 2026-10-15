import { expect, test } from './helpers/extension';
import { bulkTrash } from './helpers/scripted-scenarios';

test('previews a bulk move, re-previews when the set changes, then moves only to Trash', async ({ nudge }) => {
  await nudge.scenario(bulkTrash);
  const { page, tabId } = await nudge.open('/mailbox');
  await nudge.instruct('Move emails about invoices to Trash', tabId);

  const first = await nudge.waitForStatus(['waiting_for_confirmation']);
  expect(first.pendingPreview).toMatchObject({ count: 5, reversible: true, permanent: false });
  expect(first.pendingPreview!.samples.length).toBeGreaterThan(0);
  await expect(page.getByText('Trash (0)')).toBeVisible();

  // A new matching email arrives before the user approves.
  await page.evaluate(() =>
    (window as unknown as { __fixture: { deliver(message: unknown): void } }).__fixture.deliver({
      id: 'm99', from: 'Soylent Billing', subject: 'Invoice SOY-77 is due', body: 'Invoice SOY-77 totals $12.00.',
    }),
  );
  await expect(page.getByText('6 selected')).toBeVisible();
  await nudge.panel.getByRole('button', { name: /Move 5 items/ }).click();

  const second = await nudge.waitForStatus(['waiting_for_confirmation']);
  expect(second.pendingPreview).toMatchObject({ count: 6, operation: 'Move to Trash', reversible: true });
  expect(second.pendingPreview!.previewId).not.toBe(first.pendingPreview!.previewId);
  await expect(page.getByText('Trash (0)')).toBeVisible();
  await nudge.panel.getByRole('button', { name: /Move 6 items/ }).click();

  const done = await nudge.waitForStatus(['completed', 'partially_completed', 'failed']);
  expect(done.status).toBe('completed');
  await expect(page.getByRole('button', { name: 'Trash (6)' })).toBeVisible();
  await page.getByRole('button', { name: 'Trash (6)' }).click();
  await expect(page.getByText('Invoice SOY-77 is due')).toBeVisible();
  expect(done.authorization!.categories).not.toContain('delete_permanent');
});
