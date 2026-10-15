import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import styles from './launcher.css?inline';

const HOST_ATTRIBUTE = 'data-nudge-root';
const MARGIN = 8;
const WIDTH = 104;
const HEIGHT = 56;

export interface LauncherProps {
  onOpen(): void;
  onDismiss(): void;
}

interface MountOptions {
  onOpen(): void;
  onDismiss?: () => void;
}

let activeHost: HTMLElement | undefined;
let activeRoot: Root | undefined;
let bodyObserver: MutationObserver | undefined;
let activeOptions: MountOptions | undefined;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function Launcher({ onOpen, onDismiss }: LauncherProps) {
  const [position, setPosition] = useState({
    x: window.innerWidth - WIDTH - 16,
    y: window.innerHeight - HEIGHT - 16,
  });
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | undefined>(
    undefined,
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      setPosition({
        x: clamp(event.clientX - drag.current.offsetX, MARGIN, window.innerWidth - WIDTH - MARGIN),
        y: clamp(
          event.clientY - drag.current.offsetY,
          MARGIN,
          window.innerHeight - HEIGHT - MARGIN,
        ),
      });
    };
    const stop = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
  };

  return (
    <div className="nudge-launcher" style={{ left: position.x, top: position.y }}>
      <button
        aria-label="Move Nudge launcher"
        className="nudge-launcher__drag"
        onPointerDown={startDrag}
      >
        ⋮⋮
      </button>
      <button onClick={onOpen}>Nudge</button>
      <button
        aria-label="Dismiss Nudge on this page"
        className="nudge-launcher__dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

function createHost(): HTMLElement {
  const host = document.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = styles;
  const mountPoint = document.createElement('div');
  shadow.append(style, mountPoint);
  document.documentElement.append(host);
  activeRoot = createRoot(mountPoint);
  activeRoot.render(
    <Launcher
      onOpen={() => activeOptions?.onOpen()}
      onDismiss={() => {
        activeOptions?.onDismiss?.();
        unmountLauncher();
      }}
    />,
  );
  return host;
}

export function mountLauncher(options: MountOptions): HTMLElement {
  activeOptions = options;
  const existing = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
  if (existing?.isConnected) return existing;

  activeHost = createHost();
  bodyObserver ??= new MutationObserver(() => {
    if (!activeHost?.isConnected && activeOptions) activeHost = createHost();
  });
  bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
  return activeHost;
}

export function unmountLauncher(): void {
  bodyObserver?.disconnect();
  bodyObserver = undefined;
  activeRoot?.unmount();
  activeRoot = undefined;
  activeHost?.remove();
  activeHost = undefined;
  activeOptions = undefined;
}
