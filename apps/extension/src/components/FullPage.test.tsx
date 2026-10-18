// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidePanel } from './SidePanel';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';

afterEach(cleanup);
const props = () => ({
  busy: false,
  onSend: vi.fn(),
  onStop: vi.fn(),
  onSaveKey: vi.fn(),
  onClearKey: vi.fn(),
});
function openModels() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Choose model' }), { key: 'Enter' });
}

describe('full-page conversation', () => {
  it('keeps ChatGPT connection controls in Memory and profile, outside the composer', () => {
    const chatGpt = {
      accounts: [],
      busy: false,
      limitReached: false,
      welcome: false,
      connected: false,
      onConnect: vi.fn(),
      onReconnect: vi.fn(),
      onAddAccount: vi.fn(),
      onEnablePlan: vi.fn(),
      onDisconnect: vi.fn(),
      onSelect: vi.fn(),
      onDismissWelcome: vi.fn(),
      onManageUsage: vi.fn(),
    };
    const side = render(<SidePanel {...props()} chatGpt={chatGpt} />);
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull();
    side.unmount();
    const memoryWorkspace = { chats: [], facts: [], documents: [], refreshMemory: vi.fn().mockResolvedValue(undefined) } as unknown as MemoryWorkspace;
    render(<SidePanel {...props()} fullPage chatGpt={chatGpt} memoryWorkspace={memoryWorkspace} />);
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeTruthy();
    expect(screen.getByText(/does not import ChatGPT history/)).toBeTruthy();
    expect(screen.getByText(/separately billed OpenAI API requests/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close account' }));
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull();
  });
  it('splits full-screen account and settings, and keeps the side panel on the provider dialog', () => {
    const memoryWorkspace = {
      chats: [],
      facts: [],
      documents: [],
      refreshMemory: vi.fn().mockResolvedValue(undefined),
    } as unknown as MemoryWorkspace;
    const full = render(<SidePanel {...props()} fullPage memoryWorkspace={memoryWorkspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.queryByRole('dialog', { name: 'Provider settings' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Models' }));
    expect(screen.getByLabelText('OpenAI API key')).toBeTruthy();
    full.unmount();
    render(<SidePanel {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByRole('dialog', { name: 'Provider settings' })).toBeTruthy();
  });
  it('offers expansion only in the side panel and keeps its composer selector-free', () => {
    const onExpand = vi.fn();
    render(<SidePanel {...props()} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open full-page chat' }));
    expect(onExpand).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Choose model' })).toBeNull();
  });
  it('shows the full-page composer with a model picker and multiline input', () => {
    render(<SidePanel {...props()} fullPage />);
    expect(screen.getByText("What's on your mind?")).toBeTruthy();
    expect(screen.getByLabelText('Tell Nudge what to do').tagName).toBe('TEXTAREA');
    expect(
      screen.getByRole('form').contains(screen.getByRole('button', { name: 'Choose model' })),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Open full-page chat' })).toBeNull();
    expect(screen.getByRole('button', { name: "Summarize the page I'm on" })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(screen.getByRole('button', { name: 'Open the pricing page' })).toBeTruthy();
  });
  it('asks with question cards, rates replies, and shows browser steps as tools', () => {
    const onSelectTab = vi.fn();
    render(
      <SidePanel
        {...props()}
        fullPage
        onSelectTab={onSelectTab}
        timeline={[{ id: 'step-1', label: 'Opened example.com', status: 'completed', detail: 'Title read' }]}
        conversation={[
          {
            id: 'reply',
            role: 'assistant',
            text: 'The page title is Example.',
            createdAt: '2026-10-18T00:00:00.000Z',
            sources: [
              {
                tabId: 1,
                windowId: 1,
                active: true,
                url: 'https://example.com/',
                title: 'Example Domain',
                domain: 'example.com',
                discarded: false,
                lastSeenAt: '2026-10-18T00:00:00.000Z',
                favIconUrl: 'https://example.com/favicon.ico',
              },
            ],
          },
        ]}
        controller={{
          status: 'waiting_for_user',
          plan: [],
          memorySummary: { recordCount: 0, issues: [] },
          capability: 'dom_only',
          timeline: [],
          pendingQuestion: 'Which tab should I use?',
          tabChoices: [
            {
              number: 2,
              tabId: 9,
              windowId: 1,
              active: false,
              url: 'https://example.com/',
              title: 'Example Domain',
              domain: 'example.com',
              discarded: false,
              lastSeenAt: '2026-10-18T00:00:00.000Z',
            },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '2. example.com — Example Domain' }));
    expect(onSelectTab).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    expect(screen.getByText('Thanks. This stays on this screen.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Example Domain' })).toBeTruthy();
  });
  it('offers only discovered local models and the configured OpenAI option', async () => {
    const onProviderSelection = vi.fn();
    render(
      <SidePanel
        {...props()}
        fullPage
        onProviderSelection={onProviderSelection}
        providerSelection={{
          provider: 'ollama',
          model: 'actual-model',
          baseUrl: 'http://localhost:11434',
        }}
        providerHealth={{
          openai: { available: true },
          ollama: { available: true, models: ['actual-model', 'another-local'] },
        }}
      />,
    );
    openModels();
    const options = await screen.findAllByRole('menuitemradio');
    expect(options.map((item) => item.textContent)).toEqual([
      'OpenAIConfigured cloud model',
      'actual-modelLocal · Ollama',
      'another-localLocal · Ollama',
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /another-local/ }));
    expect(onProviderSelection).toHaveBeenCalledWith({
      provider: 'ollama',
      model: 'another-local',
      baseUrl: 'http://localhost:11434',
    });
  });
  it('shows model discovery guidance and cannot select an unavailable provider', async () => {
    render(
      <SidePanel
        {...props()}
        fullPage
        providerHealth={{ openai: { available: false }, ollama: { available: false, models: [] } }}
      />,
    );
    openModels();
    expect(await screen.findByText('No local models found.')).toBeTruthy();
    expect(screen.getByRole('menuitemradio').getAttribute('aria-disabled')).toBe('true');
  });
  it('prevents model changes during a task and displays save failures by the composer', () => {
    render(<SidePanel {...props()} fullPage busy providerError="Could not save model" />);
    expect(
      (screen.getByRole('button', { name: 'Choose model' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Could not save model');
  });
});

it('preserves a drafted follow-up while a conversational reply is pending', () => {
  const onSend = vi.fn();
  render(<SidePanel {...props()} fullPage busy allowTaskUpdates={false} onSend={onSend} />);
  const input = screen.getByLabelText('Tell Nudge what to do');
  fireEvent.change(input, { target: { value: 'Follow-up' } });
  fireEvent.submit(screen.getByRole('form'));
  expect(onSend).not.toHaveBeenCalled();
  expect((input as HTMLTextAreaElement).value).toBe('Follow-up');
  expect(screen.queryByRole('button', { name: 'Send update' })).toBeNull();
});

it('shows live voice text as a temporary conversation bubble', () => {
  const view = render(
    <SidePanel
      {...props()}
      fullPage
      liveVoiceTurn={{ role: 'assistant', text: 'Here is the first part' }}
    />,
  );
  expect(screen.getByLabelText('Live voice reply').textContent).toContain('Here is the first part');
  expect(screen.queryByText("What's on your mind?")).toBeNull();
  expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull();
  view.rerender(<SidePanel {...props()} fullPage />);
  expect(screen.queryByLabelText('Live voice reply')).toBeNull();
});
