// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionTimeline } from './ExecutionTimeline';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ExecutionTimeline', () => {
  it('shows trusted progress in an accessible live region and auto-collapses when complete', async () => {
    const { rerender } = render(
      <ExecutionTimeline
        status="running"
        steps={[{ id: 'observe-1', label: 'Reading this page', status: 'active' }]}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('Reading this page');
    expect(
      screen.getByRole('button', { name: /Nudge is working/i }).getAttribute('data-state'),
    ).toBe('open');

    rerender(
      <ExecutionTimeline
        status="completed"
        steps={[{ id: 'observe-1', label: 'Reading this page', status: 'completed' }]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Task complete/i }).getAttribute('data-state'),
      ).toBe('closed'),
    );
  });

  it('does not complete or collapse when only the current scope step is complete', () => {
    const steps = [{ id: 'scope', label: 'Using this tab', status: 'completed' as const }];
    const { rerender } = render(<ExecutionTimeline steps={steps} status="running" />);
    expect(screen.queryByText('Task complete')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    rerender(<ExecutionTimeline steps={steps} />);
    expect(screen.queryByText('Task complete')).toBeNull();
  });

  it('updates elapsed step and task seconds, then freezes completed durations', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { rerender } = render(
      <ExecutionTimeline
        status="running"
        showTimings
        startedAt={5_000}
        steps={[{ id: 'read', label: 'Reading page', status: 'active', startedAt: 8_000 }]}
      />,
    );
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('5s');
    expect(screen.getByLabelText('Reading page elapsed time').textContent).toBe('2s');
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('7s');
    expect(screen.getByLabelText('Reading page elapsed time').textContent).toBe('4s');
    rerender(
      <ExecutionTimeline
        status="completed"
        showTimings
        startedAt={5_000}
        completedAt={12_000}
        steps={[
          {
            id: 'read',
            label: 'Reading page',
            status: 'completed',
            startedAt: 8_000,
            completedAt: 11_000,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Task complete/i }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('7s');
    expect(screen.getByLabelText('Reading page elapsed time').textContent).toBe('3s');
  });

  it('switches to minutes after 60 seconds and freezes a finished step', () => {
    vi.useFakeTimers();
    vi.setSystemTime(70_000);
    render(
      <ExecutionTimeline
        status="running"
        showTimings
        startedAt={0}
        steps={[
          {
            id: 'read',
            label: 'Reading page',
            status: 'completed',
            startedAt: 0,
            completedAt: 5_000,
          },
          { id: 'open', label: 'Opening result', status: 'active', startedAt: 5_000 },
        ]}
      />,
    );
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('1m 10s');
    expect(screen.getByLabelText('Reading page elapsed time').textContent).toBe('5s');
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByLabelText('Reading page elapsed time').textContent).toBe('5s');
    expect(screen.getByLabelText('Opening result elapsed time').textContent).toBe('1m 8s');
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('1m 13s');
  });

  it('stops the reasoning timer when the task is no longer running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const { rerender } = render(
      <ExecutionTimeline
        status="running"
        showTimings
        startedAt={10_000}
        steps={[{ id: 'read', label: 'Reading page', status: 'active', startedAt: 10_000 }]}
      />,
    );
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('10s');
    rerender(
      <ExecutionTimeline
        status="paused"
        showTimings
        startedAt={10_000}
        steps={[{ id: 'read', label: 'Reading page', status: 'active', startedAt: 10_000 }]}
      />,
    );
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('10s');
    expect(screen.getByLabelText('Reading page elapsed time').textContent).toBe('10s');
  });

  it('does not invent durations for legacy steps without timestamps', () => {
    render(
      <ExecutionTimeline
        status="completed"
        steps={[{ id: 'old', label: 'Old step', status: 'completed' }]}
      />,
    );
    expect(screen.queryByLabelText(/elapsed time/)).toBeNull();
  });

  it.each(['failed', 'cancelled', 'partially_completed'] as const)(
    'does not label %s as complete',
    (status) => {
      render(
        <ExecutionTimeline
          status={status}
          steps={[{ id: 'scope', label: 'Using this tab', status: 'completed' }]}
        />,
      );
      expect(screen.queryByText('Task complete')).toBeNull();
    },
  );

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

it('hides execution durations in compact view even when timing data exists', () => {
  render(
    <ExecutionTimeline
      status="running"
      startedAt={1000}
      steps={[{ id: 'read', label: 'Read page', status: 'active', startedAt: 1000 }]}
    />,
  );
  expect(screen.queryByLabelText(/elapsed time/)).toBeNull();
});

it('does not invent elapsed time for interrupted legacy progress without timestamps', () => {
  render(
    <ExecutionTimeline
      historical
      showTimings
      status="running"
      steps={[{ id: 'old', label: 'Old unfinished step', status: 'active' }]}
    />,
  );
  expect(screen.getByRole('button', { name: 'Task interrupted' })).toBeTruthy();
  expect(screen.queryByLabelText(/elapsed time/)).toBeNull();
  expect(document.querySelector('[data-status="active"]')).toBeNull();
});
