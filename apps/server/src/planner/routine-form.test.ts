import { expect, it, vi } from 'vitest';
import { routineFormScope } from './routine-form';
import { OllamaPlanner } from './ollama-planner';
import { plannerRequest } from './test-fixtures';
import { serializeCompactPlannerRequest } from './compact-request';
const input = {
  requestId: 'scope',
  originTabId: 1,
  tabs: [{ tabId: 1, title: 'Contact', url: 'https://forms.test/contact' }],
};
it('scopes explicit current form edits without inference and without consequential grants', async () => {
  const fetch = vi.fn();
  const planner = new OllamaPlanner('http://localhost:11434', 'qwen3.5:9b', fetch);
  const result = await planner.scope(
    {
      ...input,
      instruction: 'Replace the email address in this form with alex@example.test. Do not submit.',
    },
    new AbortController().signal,
  );
  expect(result.proposal.categories).toEqual(['read', 'navigate', 'fill', 'edit']);
  expect(result.proposal.origins).toEqual(['https://forms.test']);
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  'Do not fill the form',
  'Fill this form and submit it',
  'Fill this form then open another tab',
  'Complete the payment form',
  'Fill this form and send an email',
])('keeps complex or negated work on full planning: %s', (instruction) => {
  expect(routineFormScope({ ...input, instruction })).toBeUndefined();
});
it('removes transport metadata but preserves authority, failures and live element identity', () => {
  const request = plannerRequest();
  request.memory.goal = request.goal;
  request.lastResult = { tool: 'click', ok: false, detail: 'Not verified; do not retry blindly.' };
  const result = JSON.parse(serializeCompactPlannerRequest(request));
  expect(result.requestId).toBeUndefined();
  expect(result.taskId).toBeUndefined();
  expect(result.memory.goal).toBeUndefined();
  expect(result.authorization).toEqual(request.authorization);
  expect(result.observation).toEqual(request.observation);
  expect(result.lastResult).toEqual(request.lastResult);
  expect(request.requestId).toBeDefined();
});

it('treats explicit calendar draft form filling as current-page entry, not deferred execution', () => {
  const result = routineFormScope({
    ...input,
    instruction:
      'Create a draft calendar event titled Cedar visit on October 20, 2026 at 11:00 AM. Fill the calendar form now, but do not save the event.',
  });
  expect(result?.proposal.categories).toEqual(['read', 'navigate', 'fill', 'edit']);
  expect(result?.proposal.categories).not.toContain('submit_form');
});
