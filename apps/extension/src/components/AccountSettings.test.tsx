// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSettings } from './AccountSettings';
import { Toaster } from './nexus-ui/toaster';
import type { MemoryWorkspace } from '../panel/use-memory-workspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const workspace = () =>
  ({
    chats: [{ id: 'a', title: 'First chat', updatedAt: new Date().toISOString() }],
    activeId: 'a',
    loading: false,
    facts: [{ key: 'name', value: 'Ada', source: 'user' }],
    documents: [{ id: 'cv', filename: 'CV.txt', text: 'Experience', source: 'upload' }],
    newChat: vi.fn(),
    selectChat: vi.fn(),
    deleteChat: vi.fn(),
    saveFact: vi.fn().mockResolvedValue(true),
    deleteFact: vi.fn().mockResolvedValue(true),
    uploadDocument: vi.fn(),
    saveDocument: vi.fn().mockResolvedValue(true),
    deleteDocument: vi.fn(),
    refreshMemory: vi.fn(),
  }) as unknown as MemoryWorkspace;

function renderDesk(entry: 'account' | 'settings' = 'account', data = workspace()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ autoRemember: true, localDiagnostics: false }))),
  );
  render(
    <>
      <Toaster />
      <AccountSettings
        entry={entry}
        workspace={data}
        appearance={{ theme: 'dark', toggle: vi.fn() }}
        providerSelection={{ provider: 'openai' }}
        onClose={vi.fn()}
        onSaveKey={vi.fn()}
        onClearKey={vi.fn()}
        onProviderSelection={vi.fn()}
        onRefreshProviders={vi.fn()}
        onClearHistory={vi.fn()}
      />
    </>,
  );
  return data;
}

describe('full-screen account and settings', () => {
  it('edits a remembered detail in a dialog without mixing it into another field', async () => {
    const data = renderDesk();
    fireEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    expect(screen.getByRole('dialog', { name: 'Edit detail' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What should Nudge remember?'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save detail' }));
    await waitFor(() => expect(data.saveFact).toHaveBeenCalledWith('name', 'Ada Lovelace'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved fact name' }));
    expect(screen.getByText(/original conversation is kept/)).toBeTruthy();
  });

  it('searches across account and settings, and rejects an oversized file', async () => {
    const data = renderDesk();
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'cleanup' } });
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Data' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    const file = new File(['x'], 'CV.pdf');
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Upload PDF, Word, or text'), { target: { files: [file] } });
    expect((await screen.findByRole('alert')).textContent).toContain('smaller than 5 MB');
    expect(data.uploadDocument).not.toHaveBeenCalled();
  });

  it('edits profile fields inline, filters the file grid, and deletes the selection', async () => {
    const data = workspace();
    data.documents = [
      { id: 'cv', filename: 'CV.txt', text: 'Experience', source: 'upload', createdAt: '2026-01-01' },
      { id: 'letter', filename: 'Letter.pdf', text: 'Hello', source: 'upload', createdAt: '2026-01-01' },
    ];
    renderDesk('account', data);
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(data.saveFact).toHaveBeenCalledWith('preferred_name', 'Ada'));
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    expect(screen.getByRole('button', { name: 'View CV.txt' }).textContent).toContain('TXT');
    expect(screen.getByRole('button', { name: 'View Letter.pdf' }).textContent).toContain('PDF');
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'letter' } });
    expect(screen.queryByRole('button', { name: 'View CV.txt' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Letter.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(data.deleteDocument).toHaveBeenCalledWith('letter'));
  });

  it('keeps a failed paste in the dialog', async () => {
    const data = renderDesk();
    vi.mocked(data.saveDocument).mockResolvedValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste text' }));
    fireEvent.change(screen.getByLabelText('Document name'), { target: { value: 'Important letter' } });
    fireEvent.change(screen.getByLabelText('Reference text'), { target: { value: 'Keep this unsaved draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reference' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save');
    expect((screen.getByLabelText('Reference text') as HTMLTextAreaElement).value).toBe(
      'Keep this unsaved draft.',
    );
  });
});
