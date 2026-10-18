// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryPanel } from './MemoryPanel';
import { ChatSidebar } from './ChatSidebar';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const workspace = () =>
  ({
    chats: [{ id: 'a', title: 'First chat' }],
    activeId: 'a',
    loading: false,
    facts: [{ key: 'name', value: 'Ada', source: 'user' }],
    documents: [{ id: 'cv', filename: 'CV.txt', text: 'Experience', source: 'upload' }],
    newChat: vi.fn(),
    selectChat: vi.fn(),
    deleteChat: vi.fn(),
    saveFact: vi.fn().mockResolvedValue(undefined),
    deleteFact: vi.fn().mockResolvedValue(undefined),
    uploadDocument: vi.fn(),
    saveDocument: vi.fn(),
    deleteDocument: vi.fn(),
    refreshMemory: vi.fn(),
  }) as unknown as MemoryWorkspace;
describe('local memory controls', () => {
  it('keeps chats distinct and disables switching during a task', () => {
    const data = workspace();
    render(<ChatSidebar workspace={data} busy onMemory={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'First chat' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Finish or stop/)).toBeTruthy();
  });
  it('filters saved titles and Home restores the chat view', () => {
    const onNavigate = vi.fn();
    render(
      <ChatSidebar
        workspace={workspace()}
        busy={false}
        onMemory={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search chats' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search saved chats' }), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No matching chats.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'First chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'First chat' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('confirms deletion of a saved chat', () => {
    const data = workspace();
    render(<ChatSidebar workspace={data} busy={false} onMemory={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete chat First chat' }));
    expect(data.deleteChat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(data.deleteChat).toHaveBeenCalledWith('a');
  });
  it('edits remembered details and distinguishes deleting a fact from its chat', async () => {
    const data = workspace();
    render(<MemoryPanel workspace={data} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    fireEvent.change(screen.getByLabelText('What should Nudge remember?'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save detail' }));
    await waitFor(() => expect(data.saveFact).toHaveBeenCalledWith('name', 'Ada Lovelace'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved fact name' }));
    expect(screen.getByText(/original conversation is kept/)).toBeTruthy();
  });
  it('rejects oversized files before sending them', () => {
    const data = workspace();
    render(<MemoryPanel workspace={data} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    const file = new File(['x'], 'CV.pdf');
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Upload PDF, Word, or text'), {
      target: { files: [file] },
    });
    expect(screen.getByRole('alert').textContent).toContain('smaller than 5 MB');
    expect(data.uploadDocument).not.toHaveBeenCalled();
  });
});

describe('memory tabs and document drop zone', () => {
  it('moves selection and focus with arrow, Home and End keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ autoRemember: true, localDiagnostics: false })),
      ),
    );
    render(<MemoryPanel workspace={workspace()} onClose={vi.fn()} />);
    const profile = screen.getByRole('tab', { name: 'Profile' });
    profile.focus();
    fireEvent.keyDown(profile, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel', { name: 'Documents' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Documents' }));
    expect(profile.getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tabpanel', { name: 'Settings' })).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: /Automatically remember/ }) as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(profile);
    expect(screen.getByRole('tabpanel', { name: 'Profile' })).toBeTruthy();
    expect(screen.queryByRole('tabpanel', { name: 'Documents' })).toBeNull();
  });
  it('uploads one dropped document, signals pending, and ignores a second drop until complete', async () => {
    const data = workspace();
    let finish!: (success: boolean) => void;
    vi.mocked(data.uploadDocument).mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    render(<MemoryPanel workspace={data} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    const area = screen.getByLabelText('Document upload area');
    const file = new File(['CV text'], 'resume.txt', { type: 'text/plain' });
    fireEvent.dragOver(area);
    expect(screen.getByText('Drop your document here')).toBeTruthy();
    fireEvent.drop(area, { dataTransfer: { files: [file] } });
    expect(data.uploadDocument).toHaveBeenCalledWith(file);
    expect(area.getAttribute('aria-busy')).toBe('true');
    expect(
      (screen.getByRole('button', { name: 'Choose a file' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.drop(area, { dataTransfer: { files: [file] } });
    expect(data.uploadDocument).toHaveBeenCalledOnce();
    finish(true);
    await waitFor(() => expect(area.getAttribute('aria-busy')).toBe('false'));
  });
  it('rejects multiple dropped files and unsupported types without uploading', () => {
    const data = workspace();
    render(<MemoryPanel workspace={data} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    const area = screen.getByLabelText('Document upload area');
    fireEvent.drop(area, {
      dataTransfer: { files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] },
    });
    expect(screen.getByRole('alert').textContent).toContain('one document at a time');
    fireEvent.drop(area, { dataTransfer: { files: [new File(['x'], 'photo.png')] } });
    expect(screen.getByRole('alert').textContent).toContain('Choose a PDF');
    expect(data.uploadDocument).not.toHaveBeenCalled();
  });
  it('shows a failed profile save without losing entered text', async () => {
    const data = workspace();
    vi.mocked(data.saveFact).mockRejectedValue(new Error('Local database is unavailable'));
    render(<MemoryPanel workspace={data} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Detail name'), { target: { value: 'Role' } });
    fireEvent.change(screen.getByLabelText('What should Nudge remember?'), {
      target: { value: 'Designer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save detail' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Local database is unavailable',
    );
    expect(
      (screen.getByLabelText('What should Nudge remember?') as HTMLTextAreaElement).value,
    ).toBe('Designer');
  });
  it('loads saved settings and preserves the last saved choice when saving fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ autoRemember: true, localDiagnostics: false })),
      )
      .mockRejectedValueOnce(new Error('Offline'));
    vi.stubGlobal('fetch', fetch);
    render(<MemoryPanel workspace={workspace()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    const toggle = screen.getByRole('switch', {
      name: /Automatically remember/,
    }) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    fireEvent.click(toggle);
    await screen.findByRole('alert');
    expect(toggle.checked).toBe(true);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body)).toEqual({
      autoRemember: false,
      localDiagnostics: false,
    });
  });
});

it.each(['rejected', 'reported'] as const)(
  'stops older-chat cleanup on a %s failure and shows the problem',
  async (failure) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ autoRemember: true, localDiagnostics: false })),
      ),
    );
    const data = workspace();
    data.chats.push(
      ...['old-one', 'old-two'].map((id) => ({
        id,
        title: id,
        createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
        generation: 0,
      })),
    );
    if (failure === 'reported') vi.mocked(data.deleteChat).mockResolvedValue(false);
    else vi.mocked(data.deleteChat).mockRejectedValue(new Error('Could not delete this chat'));
    render(<MemoryPanel workspace={data} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: /Automatically remember/ }) as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete matching chats' }));
    expect(data.deleteChat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Cleanup stopped');
    expect(data.deleteChat).toHaveBeenCalledTimes(1);
    expect(data.deleteChat).toHaveBeenCalledWith('old-one', expect.any(Number));
  },
);

it('keeps pasted document text when the workspace reports a failed save', async () => {
  const data = workspace();
  vi.mocked(data.saveDocument).mockResolvedValue(false);
  render(<MemoryPanel workspace={data} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
  fireEvent.click(screen.getByText('Or paste reference text'));
  fireEvent.change(screen.getByLabelText('Document name'), {
    target: { value: 'Important letter' },
  });
  fireEvent.change(screen.getByLabelText('Reference text', { exact: true }), {
    target: { value: 'Keep this unsaved draft.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save reference' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not save');
  expect(
    (screen.getByLabelText('Reference text', { exact: true }) as HTMLTextAreaElement).value,
  ).toBe('Keep this unsaved draft.');
  expect((screen.getByLabelText('Document name') as HTMLInputElement).value).toBe(
    'Important letter',
  );
});
