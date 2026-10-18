import { expect, it, vi } from 'vitest';
import { OllamaPlanner } from './ollama-planner';
import { plannerRequest } from './test-fixtures';
it('scopes and executes exact website navigation without model inference, finishing only on the destination', async () => {
  const fetcher = vi.fn();
  const planner = new OllamaPlanner('http://127.0.0.1:11434', 'qwen3.5:9b', fetcher);
  const signal = new AbortController().signal;
  const scope = await planner.scope(
    { requestId: 's', instruction: 'Open YouTube.', tabs: [] },
    signal,
  );
  expect(scope.proposal.origins).toEqual(['https://www.youtube.com']);
  const request = plannerRequest({ goal: scope.goal });
  request.authorization.instruction = 'Open YouTube.';
  const step = await planner.plan(request, signal);
  expect(step.toolCall).toEqual({ tool: 'navigate', tabId: 4, url: 'https://www.youtube.com/' });
  request.observation!.snapshot.url = 'https://www.youtube.com/';
  const done = await planner.plan(request, signal);
  expect(done.toolCall).toMatchObject({ tool: 'finish', evidence: ['https://www.youtube.com/'] });
  expect(fetcher).not.toHaveBeenCalled();
});

import { directDestination, directNavigationPlan } from './direct-navigation';
it('keeps explicit current-tab navigation on the fast path', () => {
  expect(directDestination('Open https://example.com in this tab.')).toBe('https://example.com/');
});
it.each([
  'How do I open YouTube?',
  'Do not open YouTube',
  'Open YouTube and search for music',
  'Open an unknown site',
  'Open constructor',
  'Open YouTube in a new tab',
])('leaves ambiguous or compound requests to planning: %s', (text) => {
  expect(directDestination(text)).toBeUndefined();
});
it('preserves a literal destination and defers corrections to the planner', () => {
  expect(directDestination('Please open https://example.com/products?q=phone')).toBe(
    'https://example.com/products?q=phone',
  );
  const request = plannerRequest();
  request.authorization.instruction = 'Open YouTube';
  request.memory.constraints = [{ text: 'Actually use Apple instead', instructionVersion: 1 }];
  expect(directNavigationPlan(request)).toBeUndefined();
});
