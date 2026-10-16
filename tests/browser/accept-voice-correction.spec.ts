import { expect, test } from './helpers/extension';
import { voiceCorrection } from './helpers/scripted-scenarios';

test('a spoken correction during an active task replaces queued work and changes the result', async ({ nudge }) => {
  await nudge.scenario(voiceCorrection);
  const sheet = await nudge.open('/sheet');
  const { tabId } = await nudge.open('/jobs');
  await nudge.instruct('Find frontend jobs and add them to the sheet', tabId);

  await expect.poll(async () => (await nudge.state())?.records ?? 0, { timeout: 30_000 }).toBe(2);
  await nudge.injectTranscript('Actually, only include remote roles');

  const state = await nudge.waitForStatus(['completed', 'partially_completed', 'failed'], 60_000);
  expect(state.status).toBe('completed');
  await expect(sheet.page.getByRole('gridcell', { name: 'A2', exact: true })).toHaveText('Senior Frontend Engineer');
  await expect(sheet.page.getByRole('gridcell', { name: 'A3', exact: true })).toHaveText('');
  await expect(sheet.page.getByText('Frontend Developer', { exact: true })).toHaveCount(0);

  const plans = (await nudge.plannerLog()).filter((entry) => entry.kind === 'plan').map((entry) => entry.request as { instructionVersion: number; memory: { constraints: Array<{ text: string }> } });
  const corrected = plans.find((request) => request.instructionVersion === 1);
  expect(corrected?.memory.constraints.map((constraint) => constraint.text)).toContain('Actually, only include remote roles');
  // The Berlin row that was queued under the old instruction never reached the sheet.
  await expect(sheet.page.getByText('Rows filled: 1')).toBeVisible();
});
