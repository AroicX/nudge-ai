// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduledTasks } from './ScheduledTasks';
afterEach(cleanup);
it('shows retained source/provider, pending cancellation and failures after reconnect', () => {
  const cancel = vi.fn();
  const base = {
    id: 'one',
    instruction: 'Check this page',
    runAt: 1792324800000,
    originTabId: 1,
    originUrl: 'https://example.com/path',
    provider: 'ollama' as const,
  };
  render(
    <ScheduledTasks
      jobs={[
        { ...base, status: 'pending' },
        { ...base, id: 'two', status: 'failed', detail: 'Nudge server is unavailable' },
      ]}
      onCancel={cancel}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel scheduled task: Check this page' }));
  expect(cancel).toHaveBeenCalledWith('one');
  expect(screen.getByText('Nudge server is unavailable')).toBeTruthy();
  expect(screen.getByText('example.com · pending')).toBeTruthy();
});
it('offers Dismiss for orphaned attention jobs but never for the active waiting task', () => {
  const job = {
    id: 'one',
    instruction: 'Check this page',
    runAt: 1792324800000,
    originTabId: 1,
    originUrl: 'https://example.com',
    provider: 'ollama' as const,
    status: 'attention' as const,
  };
  const cancel = vi.fn();
  const view = render(<ScheduledTasks jobs={[job]} onCancel={cancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss scheduled task: Check this page' }));
  expect(cancel).toHaveBeenCalledWith('one');
  view.rerender(<ScheduledTasks jobs={[job]} onCancel={cancel} activeTaskId="one" />);
  expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
});
