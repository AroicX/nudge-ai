// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SidePanel } from './SidePanel';

afterEach(cleanup);

describe('SidePanel', () => {
  it('uses a single-line composer and keeps Stop available while work is active', () => {
    const onSend = vi.fn();
    render(
      <SidePanel busy onSend={onSend} onStop={vi.fn()} onSaveKey={vi.fn()} onClearKey={vi.fn()} />,
    );
    const input = screen.getByLabelText('Tell Nudge what to do');
    expect(input.tagName).toBe('INPUT');
    fireEvent.change(input, {
      target: { value: 'Find an iPhone 16' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Message Nudge' }));
    expect(onSend).toHaveBeenCalledWith('Find an iPhone 16');
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('opens settings from the header and can replace or clear a session-only provider key', () => {
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
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByRole('dialog', { name: 'OpenAI settings' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('OpenAI API key'), {
      target: { value: 'sk-session-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use local default' }));
    expect(onSaveKey).toHaveBeenCalledWith('sk-session-test');
    expect(onClearKey).toHaveBeenCalledOnce();
  });

  it('puts voice in the composer and removes the action accordion', () => {
    const onStartVoice = vi.fn();
    render(
      <SidePanel
        busy={false}
        actions={[{ id: 'action-1', ok: true, summary: 'Clicked result' }] as never}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
        onStartVoice={onStartVoice}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start voice call' }));
    expect(onStartVoice).toHaveBeenCalledOnce();
    expect(screen.queryByText('Action history')).toBeNull();
  });

  it('puts completed dictation in the composer without sending it', async () => {
    const onSend = vi.fn();
    render(
      <SidePanel
        busy={false}
        onSend={onSend}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
        onDictate={vi.fn().mockResolvedValue('Open the latest invoice')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dictate message' }));
    expect(await screen.findByDisplayValue('Open the latest invoice')).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('copies each conversation message from the control beneath it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <SidePanel
        busy={false}
        conversation={[
          { id: 'turn-1', role: 'user', text: 'Find a phone', createdAt: '2026-10-15' },
          { id: 'turn-2', role: 'assistant', text: 'I found one', createdAt: '2026-10-15' },
        ]}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );
    const copyButtons = screen.getAllByRole('button', { name: 'Copy message' });
    fireEvent.click(copyButtons[1]!);
    expect(writeText).toHaveBeenCalledWith('I found one');
  });

  it('renders linked source chips beneath a message', () => {
    const onOpenSource = vi.fn();
    render(
      <SidePanel
        busy={false}
        conversation={[
          {
            id: 'turn-source',
            role: 'assistant',
            text: 'Found it',
            createdAt: '2026-10-15T20:00:00.000Z',
            sources: [
              {
                tabId: 3,
                windowId: 1,
                active: false,
                url: 'https://mail.google.com/',
                title: 'Netflix payment reminder',
                domain: 'mail.google.com',
                discarded: false,
                lastSeenAt: '2026-10-15T20:00:00.000Z',
              },
            ],
          },
        ]}
        onOpenSource={onOpenSource}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Netflix payment reminder on mail.google.com' }),
    );
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ tabId: 3 }));
  });
});
