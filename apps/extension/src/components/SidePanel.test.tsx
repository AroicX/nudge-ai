// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SidePanel } from './SidePanel';

afterEach(cleanup);

describe('SidePanel', () => {
  it('clears the visible conversation from the header', () => {
    const onClearHistory = vi.fn();
    render(
      <SidePanel
        busy={false}
        conversation={[
          { id: 'turn-1', role: 'user', text: 'Find a kettle', createdAt: '2026-10-15' },
        ]}
        onClearHistory={onClearHistory}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }));

    expect(onClearHistory).toHaveBeenCalledOnce();
  });

  it('prevents clearing chat while an action is running', () => {
    render(
      <SidePanel
        busy
        conversation={[
          { id: 'turn-1', role: 'user', text: 'Find a kettle', createdAt: '2026-10-15' },
        ]}
        onClearHistory={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );

    expect((screen.getByRole('button', { name: 'Clear chat' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('embeds action progress after the latest user request and before its response', () => {
    render(
      <SidePanel
        busy={false}
        conversation={[
          { id: 'turn-1', role: 'user', text: 'Find a kettle', createdAt: '2026-10-15' },
          { id: 'turn-2', role: 'assistant', text: 'I found one', createdAt: '2026-10-15' },
        ]}
        timeline={[{ id: 'step-1', label: 'Searched Jumia', status: 'completed' }]}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );

    const userMessage = screen.getByText('Find a kettle').closest('article')!;
    const progress = screen.getByRole('region', { name: 'Action progress' });
    const assistantMessage = screen.getByText('I found one').closest('article')!;

    expect(
      userMessage.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      progress.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps saved task progress before later casual messages and shows each task duration', () => {
    render(
      <SidePanel
        fullPage
        busy={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
        conversation={[
          {
            id: 'one',
            role: 'user',
            text: 'Find a phone',
            createdAt: '2026-10-15',
            progress: {
              taskId: 'a',
              status: 'completed',
              startedAt: 1000,
              completedAt: 6000,
              steps: [{ id: 'a1', label: 'Found phone', status: 'completed' }],
            },
          },
          { id: 'chat', role: 'user', text: 'Thanks', createdAt: '2026-10-15' },
          {
            id: 'two',
            role: 'user',
            text: 'Find a kettle',
            createdAt: '2026-10-15',
            progress: {
              taskId: 'b',
              status: 'completed',
              startedAt: 10000,
              completedAt: 18000,
              steps: [{ id: 'b1', label: 'Found kettle', status: 'completed' }],
            },
          },
        ]}
        timeline={[{ id: 'b1', label: 'Found kettle', status: 'completed' }]}
      />,
    );
    const regions = screen.getAllByRole('region', { name: 'Action progress' });
    expect(regions).toHaveLength(2);
    expect(
      regions[0]!.compareDocumentPosition(screen.getByText('Thanks')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByLabelText('Task elapsed time').map((item) => item.textContent)).toEqual([
      '5s',
      '8s',
    ]);
  });

  it('uses a single-line composer and sends typed text as a task update while work is active', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <SidePanel busy onSend={onSend} onStop={onStop} onSaveKey={vi.fn()} onClearKey={vi.fn()} />,
    );
    const input = screen.getByLabelText('Tell Nudge what to do');
    expect(input.tagName).toBe('INPUT');
    fireEvent.change(input, {
      target: { value: 'Only black ones' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Message Nudge' }));
    expect(onSend).toHaveBeenCalledWith('Only black ones');
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
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
    expect(screen.getByRole('dialog', { name: 'Provider settings' })).toBeTruthy();
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

  it('floats a bare cloud orb above the composer and ends voice from a red close button', () => {
    const onEndVoice = vi.fn();
    render(
      <SidePanel
        busy={false}
        voiceState="listening"
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
        onEndVoice={onEndVoice}
      />,
    );

    const composer = screen.getByRole('form', { name: 'Message Nudge' });
    const orb = document.querySelector('[data-orb-state="listening"]')!.closest('.voice-orb')!;
    const close = screen.getByRole('button', { name: 'End voice call' });
    expect(orb.classList.contains('composer__voice-orb')).toBe(true);
    expect(composer.contains(orb)).toBe(true);
    expect(orb.closest('button')).toBeNull();
    expect(close.classList.contains('icon-button--danger')).toBe(true);
    fireEvent.click(close);
    expect(onEndVoice).toHaveBeenCalledOnce();
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

  it('shows stable numbered tab choices and selects one by its number', () => {
    const onSelectTab = vi.fn();
    render(
      <SidePanel
        busy={false}
        controller={{
          status: 'waiting_for_user',
          plan: [],
          memorySummary: { recordCount: 0, issues: [] },
          capability: 'dom_only',
          timeline: [],
          pendingQuestion: 'Which tab should I use?',
          tabChoices: [
            {
              number: 5,
              tabId: 22,
              windowId: 1,
              active: false,
              url: 'https://mail.google.com/mail/u/0/',
              title: 'Inbox - person@example.com - Gmail',
              domain: 'mail.google.com',
              discarded: false,
              lastSeenAt: '2026-10-16T00:00:00.000Z',
            },
          ],
        }}
        onSelectTab={onSelectTab}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );

    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('mail.google.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Tab 5.*Gmail/i }));
    expect(onSelectTab).toHaveBeenCalledWith(5);
  });

  it('selects Ollama, shows empty-model guidance, and keeps dictation without realtime voice', () => {
    const onProviderSelection = vi.fn();
    render(
      <SidePanel
        busy={false}
        showRealtimeVoice={false}
        providerSelection={{
          provider: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          model: 'qwen3',
        }}
        providerHealth={{
          openai: { available: true },
          ollama: { available: true, models: [] },
        }}
        onProviderSelection={onProviderSelection}
        onRefreshProviders={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Start voice call' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dictate message' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByText(/No Ollama models found/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use OpenAI' }));
    expect(onProviderSelection).toHaveBeenCalledWith({ provider: 'openai' });
  });

  it('does not invent or persist an Ollama model when discovery is empty', () => {
    const onProviderSelection = vi.fn();
    render(
      <SidePanel
        busy={false}
        providerHealth={{ openai: { available: true }, ollama: { available: true, models: [] } }}
        onProviderSelection={onProviderSelection}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use Ollama' }));
    expect(screen.getByText(/No Ollama models found/i)).toBeTruthy();
    expect(onProviderSelection).not.toHaveBeenCalled();
  });
});

it('keeps compact action progress free of elapsed-time labels', () => {
  render(
    <SidePanel
      busy={false}
      onSend={vi.fn()}
      onStop={vi.fn()}
      onSaveKey={vi.fn()}
      onClearKey={vi.fn()}
      conversation={[
        {
          id: 'a',
          role: 'user',
          text: 'Open the page',
          createdAt: '2026-10-15',
          progress: {
            taskId: 'task-a',
            status: 'completed',
            startedAt: 0,
            completedAt: 5000,
            steps: [{ id: 's', label: 'Opened', status: 'completed' }],
          },
        },
      ]}
    />,
  );
  expect(screen.getByRole('region', { name: 'Action progress' })).toBeTruthy();
  expect(screen.queryByLabelText('Task elapsed time')).toBeNull();
});

it('freezes interrupted historical progress while keeping the current controller task live', () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const progress = {
    taskId: 'old',
    status: 'running' as const,
    startedAt: 1000,
    steps: [
      {
        id: 'done',
        label: 'Read page',
        status: 'completed' as const,
        startedAt: 1000,
        completedAt: 4000,
      },
      { id: 'active', label: 'Opening result', status: 'active' as const, startedAt: 5000 },
    ],
  };
  const props = {
    fullPage: true,
    busy: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    onSaveKey: vi.fn(),
    onClearKey: vi.fn(),
    conversation: [
      { id: 'user', role: 'user' as const, text: 'Old task', createdAt: '2026-10-18', progress },
    ],
  };
  try {
    const { rerender } = render(<SidePanel {...props} />);
    expect(screen.getByRole('button', { name: 'Task interrupted' })).toBeTruthy();
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('4s');
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('4s');
    expect(screen.queryByText('Task complete')).toBeNull();
    expect(progress.status).toBe('running');
    expect(progress.steps[1]!.status).toBe('active');
    rerender(
      <SidePanel
        {...props}
        controller={{
          taskId: 'old',
          status: 'running',
          plan: [],
          timeline: [],
          memorySummary: { recordCount: 0, issues: [] },
          capability: 'dom_only',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Task interrupted' })).toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText('Task elapsed time').textContent).toBe('1m 46s');
  } finally {
    vi.useRealTimers();
  }
});
