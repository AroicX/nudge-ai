import { expect, test } from './helpers/extension';
import { emailSummary } from './helpers/scripted-scenarios';

test('summarises unread invoice emails without changing the mailbox', async ({ nudge }) => {
  await nudge.scenario(emailSummary);
  const { page, tabId } = await nudge.open('/mailbox');
  await nudge.instruct('Show me unread emails about invoices', tabId);

  const state = await nudge.waitForStatus(['completed', 'partially_completed', 'failed']);
  expect(state.status).toBe('completed');
  await expect(page.getByText('4 conversations matching “invoice”')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trash (0)' })).toBeVisible();
  expect(state.report!.summary).toContain('Invoice INV-1001 for September');
  expect(state.report!.verified.join(' ')).toMatch(/4 conversations/);
  await expect(nudge.panel.getByRole('heading', { name: 'Done' })).toBeVisible();
});
