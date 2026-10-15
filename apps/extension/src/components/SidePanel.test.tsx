// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SidePanel } from './SidePanel';

afterEach(cleanup);

describe('SidePanel', () => {
  it('sends text and keeps Stop available while work is active', () => {
    const onSend = vi.fn();
    render(
      <SidePanel busy onSend={onSend} onStop={vi.fn()} onSaveKey={vi.fn()} onClearKey={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Tell Nudge what to do'), {
      target: { value: 'Find an iPhone 16' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Message Nudge' }));
    expect(onSend).toHaveBeenCalledWith('Find an iPhone 16');
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('can replace and clear a session-only provider key', () => {
    const onSaveKey = vi.fn();
    const onClearKey = vi.fn();
    render(
      <SidePanel
        busy={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={onSaveKey}
        onClearKey={onClearKey}
      />,
    );
    fireEvent.change(screen.getByLabelText('OpenAI API key'), {
      target: { value: 'sk-session-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use local default' }));
    expect(onSaveKey).toHaveBeenCalledWith('sk-session-test');
    expect(onClearKey).toHaveBeenCalledOnce();
  });
});
