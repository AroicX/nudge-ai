// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidePanel } from './SidePanel';

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
