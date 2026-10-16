import { expect, test } from './helpers/extension';
import { otpTransfer } from './helpers/scripted-scenarios';

test('copies an explicitly requested fake code into the right field without submitting or leaking it', async ({ nudge }) => {
  await nudge.scenario(otpTransfer);
  await nudge.open('/mailbox');
  const { page, tabId } = await nudge.open('/verification');
  await nudge.instruct('Copy the Acme sign-in code from my email into this page', tabId);

  const state = await nudge.waitForStatus(['completed', 'partially_completed', 'failed']);
  expect(state.status).toBe('completed');
  await expect(page.getByLabel('One-time code')).toHaveValue('482913');
  await expect(page.getByText('Submitted: no')).toBeVisible();

  // The code never appears in the panel, extension storage or anything sent to the planner.
  expect(await nudge.panel.content()).not.toContain('482913');
  const stored = await nudge.worker.evaluate(async () =>
    JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]),
  );
  expect(stored).not.toContain('482913');
  expect(JSON.stringify(await nudge.plannerLog())).not.toContain('482913');
  expect(JSON.stringify(state)).not.toContain('482913');
});
