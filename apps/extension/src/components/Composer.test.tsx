// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PendingImage } from '../chat/image-attachments';
import { Composer } from './Composer';

afterEach(() => cleanup());

const base = {
  busy: false,
  voiceState: 'idle' as const,
  draft: '',
  showRealtimeVoice: false,
  dictating: false,
  onDraftChange: vi.fn(),
  onDictate: vi.fn(),
  onStop: vi.fn(),
  onStartVoice: vi.fn(),
  onEndVoice: vi.fn(),
};
const ready: PendingImage = {
  id: '1',
  name: 'shot.png',
  status: 'ready',
  input: { name: 'shot.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
  turn: { name: 'shot.png', mime: 'image/png', width: 10, height: 10, thumbnail: 'data:image/jpeg;base64,AAAA' },
};

describe('Composer image attachments', () => {
  it('accepts pasted, dropped and chosen images', () => {
    const onAddImages = vi.fn();
    const { container } = render(<Composer {...base} onSend={vi.fn()} onAddImages={onAddImages} />);
    const image = new File(['x'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(screen.getByLabelText('Tell Nudge what to do'), { clipboardData: { files: [image] } });
    fireEvent.drop(container.querySelector('form')!, { dataTransfer: { files: [image], types: ['Files'] } });
    fireEvent.change(screen.getByLabelText('Choose images to attach'), { target: { files: [image] } });
    expect(onAddImages).toHaveBeenCalledTimes(3);
    expect(onAddImages.mock.calls[0]![0][0].name).toBe('paste.png');
    expect(screen.getByRole('button', { name: 'Attach images' })).toBeTruthy();
  });

  it('shows previews with remove controls, progress and errors', () => {
    const onRemoveImage = vi.fn();
    render(
      <Composer
        {...base}
        onSend={vi.fn()}
        onAddImages={vi.fn()}
        onRemoveImage={onRemoveImage}
        images={[ready, { id: '2', name: 'big.png', status: 'preparing' }]}
        imageError="“doc.pdf” is not a supported image. Use PNG, JPEG, WebP or GIF."
      />,
    );
    expect(screen.getByAltText('shot.png')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Preparing big.png' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/not a supported image/);
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    expect(onRemoveImage).toHaveBeenCalledWith('1');
  });

  it('sends an image-only message once images are ready', () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} onAddImages={vi.fn()} images={[ready]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('What is in this image?');
  });
});
