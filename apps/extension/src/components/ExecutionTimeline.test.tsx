// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExecutionTimeline } from './ExecutionTimeline';

afterEach(cleanup);

describe('ExecutionTimeline', () => {
  it('shows trusted progress in an accessible live region and auto-collapses when complete', async () => {
    const { rerender } = render(
      <ExecutionTimeline
        steps={[{ id: 'observe-1', label: 'Reading this page', status: 'active' }]}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Reading this page');
    expect(
      screen.getByRole('button', { name: /Nudge is working/i }).getAttribute('data-state'),
    ).toBe('open');

    rerender(
      <ExecutionTimeline
        steps={[{ id: 'observe-1', label: 'Reading this page', status: 'completed' }]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Task complete/i }).getAttribute('data-state'),
      ).toBe('closed'),
    );
  });

  it('keeps errors expanded, renders safe source labels, and exposes no private reasoning fields', () => {
    render(
      <ExecutionTimeline
        steps={[
          {
            id: 'action-1',
            label: 'Opening Gmail',
            status: 'error',
            detail: 'The tab could not be opened.',
            sources: [
              {
                tabId: 2,
                windowId: 1,
                active: false,
                url: 'https://mail.google.com/',
                title: 'Inbox',
                domain: 'mail.google.com',
                discarded: false,
                lastSeenAt: '2026-10-15T20:00:00.000Z',
              },
            ],
          },
        ]}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Nudge needs attention/i }).getAttribute('data-state'),
    ).toBe('open');
    expect(screen.getByText('mail.google.com')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/reasoning|thoughts/i);
  });
});
