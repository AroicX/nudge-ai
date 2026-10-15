// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Launcher, mountLauncher, unmountLauncher } from './Launcher';

afterEach(() => {
  unmountLauncher();
  document.body.replaceChildren();
});

describe('launcher lifecycle', () => {
  it('prevents duplicate launcher hosts and cleans up', () => {
    const first = mountLauncher({ onOpen: vi.fn() });
    const second = mountLauncher({ onOpen: vi.fn() });

    expect(second).toBe(first);
    expect(document.querySelectorAll('[data-nudge-root]')).toHaveLength(1);

    unmountLauncher();
    expect(document.querySelector('[data-nudge-root]')).toBeNull();
  });

  it('survives SPA body replacement by remounting once', async () => {
    mountLauncher({ onOpen: vi.fn() });
    document.body.replaceChildren(document.createElement('main'));

    await vi.waitFor(() => expect(document.querySelectorAll('[data-nudge-root]')).toHaveLength(1));
  });
});

describe('Launcher', () => {
  it('can be dismissed for the current page', () => {
    const onDismiss = vi.fn();
    render(<Launcher onOpen={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Nudge on this page' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps dragging within the viewport', () => {
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 320 },
      innerHeight: { configurable: true, value: 480 },
    });
    const { container } = render(<Launcher onOpen={vi.fn()} onDismiss={vi.fn()} />);
    const launcher = container.firstElementChild as HTMLElement;
    const handle = screen.getByRole('button', { name: 'Move Nudge launcher' });

    fireEvent.pointerDown(handle, { clientX: 300, clientY: 460, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 900, clientY: 900, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(Number.parseFloat(launcher.style.left)).toBeLessThanOrEqual(264);
    expect(Number.parseFloat(launcher.style.top)).toBeLessThanOrEqual(424);
    expect(Number.parseFloat(launcher.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseFloat(launcher.style.top)).toBeGreaterThanOrEqual(8);
  });
});
