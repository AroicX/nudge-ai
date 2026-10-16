import { expect, test } from './helpers/extension';
import { timedScroll } from './helpers/scripted-scenarios';

test('scrolls every three seconds and stops immediately when told to', async ({ nudge }) => {
  await nudge.scenario(timedScroll);
  const { page, tabId } = await nudge.open('/long-scroll');
  const scrollY = () => page.evaluate(() => window.scrollY);
  await nudge.instruct('Scroll this page every three seconds until I say stop', tabId);

  await expect.poll(scrollY, { timeout: 5_000 }).toBeGreaterThan(0);
  const first = await scrollY();
  await expect.poll(scrollY, { timeout: 5_000 }).toBeGreaterThan(first);
  const plannerCalls = (await nudge.plannerLog()).filter((entry) => entry.kind === 'plan').length;

  await nudge.instruct('stop', tabId);
  const state = await nudge.waitForStatus(['cancelled', 'completed']);
  const stoppedAt = await scrollY();
  await page.waitForTimeout(4_000);
  expect(await scrollY()).toBe(stoppedAt);
  expect(state.status).toBe('cancelled');
  // No model call per tick: the planner was consulted once to start the repeat.
  expect(plannerCalls).toBe(1);
});
