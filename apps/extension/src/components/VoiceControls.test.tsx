// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoiceControls } from './VoiceControls';

afterEach(cleanup);

describe('VoiceControls', () => {
  it('distinguishes End Call from task Stop and exposes interruption', () => {
    const onEnd = vi.fn();
    const onInterrupt = vi.fn();
    render(
      <VoiceControls
        state="assistant-speaking"
        muted={false}
        onStart={vi.fn()}
        onEnd={onEnd}
        onMute={vi.fn()}
        onInterrupt={onInterrupt}
      />,
    );
    expect(document.querySelector('[data-orb-state="speaking"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }));
    fireEvent.click(screen.getByRole('button', { name: 'End voice call' }));
    expect(onInterrupt).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('keeps a fallback available after realtime failure', () => {
    const fallback = vi.fn();
    render(
      <VoiceControls
        state="failed"
        muted={false}
        onStart={vi.fn()}
        onEnd={vi.fn()}
        onMute={vi.fn()}
        onInterrupt={vi.fn()}
        onPushToTalk={fallback}
      />,
    );
    expect(document.querySelector('[data-orb-state="error"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Push to talk' }));
    expect(fallback).toHaveBeenCalledOnce();
    expect(screen.getByText(/typing still works/i)).toBeTruthy();
  });
});
