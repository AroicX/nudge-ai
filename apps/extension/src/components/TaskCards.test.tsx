// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CapabilityPrompt } from './CapabilityPrompt';
import { PreviewCard } from './PreviewCard';
import { ReportCard } from './ReportCard';
import { SidePanel } from './SidePanel';

afterEach(cleanup);

const preview = {
  previewId: 'preview_1', operation: 'Move to Trash', location: 'Inbox — ada@example.com', criteria: 'Subject contains “invoice”',
  count: 5, samples: ['Invoice #1', 'Invoice #2'], reversible: true, permanent: false, targetFingerprint: 'fp',
};

describe('PreviewCard', () => {
  it('shows count, samples and reversibility, and binds approve to the previewId', () => {
    const onConfirm = vi.fn();
    render(<PreviewCard preview={preview} onConfirm={onConfirm} />);
    expect(screen.getByText('Move to Trash')).toBeTruthy();
    expect(screen.getByText('5 items', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('Invoice #1')).toBeTruthy();
    expect(screen.getByText(/can be undone/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Move 5 items/i }));
    expect(onConfirm).toHaveBeenCalledWith('preview_1', true);
    fireEvent.click(screen.getByRole('button', { name: /Don’t do it/i }));
    expect(onConfirm).toHaveBeenCalledWith('preview_1', false);
  });

  it('warns clearly about permanent deletion', () => {
    render(<PreviewCard preview={{ ...preview, operation: 'Delete forever', reversible: false, permanent: true }} onConfirm={vi.fn()} />);
    expect(screen.getByText(/permanent and cannot be undone/i)).toBeTruthy();
  });
});

describe('ReportCard', () => {
  it('separates verified, partial, unverified and skipped work', () => {
    render(
      <ReportCard
        report={{
          outcome: 'partially_completed', summary: 'Added 3 of 5 jobs.',
          verified: ['Row 2 read back'], partial: ['Write remaining 2 rows'], unverified: ['Clicked save'],
          skipped: [{ item: 'Delete spam', reason: 'Not requested' }], sources: ['https://jobs.test/a/1'], exports: [],
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: /Partly done/i })).toBeTruthy();
    expect(screen.getByText('Row 2 read back')).toBeTruthy();
    expect(screen.getByText('Write remaining 2 rows')).toBeTruthy();
    expect(screen.getByText('Clicked save')).toBeTruthy();
    expect(screen.getByText(/Delete spam — Not requested/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'jobs.test' }).getAttribute('href')).toBe('https://jobs.test/a/1');
  });
});

describe('CapabilityPrompt', () => {
  it('explains the debugging bar and retries from a click', () => {
    const onRetry = vi.fn();
    render(<CapabilityPrompt reason="DevTools is open on this tab." onRetry={onRetry} onDismiss={vi.fn()} />);
    expect(screen.getByText(/started debugging this browser/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('SidePanel during a task', () => {
  it('keeps the composer usable so typed corrections reach the running task', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<SidePanel busy onSend={onSend} onStop={onStop} onSaveKey={vi.fn()} onClearKey={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Tell Nudge what to do'), { target: { value: 'only include remote roles' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send update' }));
    expect(onSend).toHaveBeenCalledWith('only include remote roles');
  });

  it('renders a pending preview and continue-after-budget control from controller state', () => {
    const onConfirm = vi.fn();
    const onContinue = vi.fn();
    render(
      <SidePanel
        busy={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
        onConfirm={onConfirm}
        onContinue={onContinue}
        controller={{ status: 'paused', plan: [], memorySummary: { recordCount: 0, issues: [] }, capability: 'dom_only', timeline: [], pendingPreview: preview }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Move 5 items/i }));
    expect(onConfirm).toHaveBeenCalledWith('preview_1', true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
