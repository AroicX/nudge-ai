const CURSOR_ID = 'nudge-action-cursor';

function ensureCursor(document: Document): HTMLDivElement {
  const existing = document.getElementById(CURSOR_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const cursor = document.createElement('div');
  cursor.id = CURSOR_ID;
  cursor.dataset.nudgeRoot = 'action-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = `
    <svg viewBox="0 0 28 32" width="18" height="22" aria-hidden="true">
      <path d="M3 2.5v23.2l6.1-5.5 4.2 9.1 4.4-2-4.1-8.8h8.2L3 2.5Z" fill="#fff" fill-opacity="0.72" stroke="#171827" stroke-opacity="0.86" stroke-width="2.1" stroke-linejoin="round"/>
    </svg>
    <span></span>
  `;
  Object.assign(cursor.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: '0',
    top: '0',
    width: '18px',
    height: '22px',
    pointerEvents: 'none',
    opacity: '0',
    transform: 'translate3d(-40px,-40px,0)',
    transition: 'transform 220ms cubic-bezier(.2,.8,.2,1), opacity 100ms ease',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.22))',
  });
  const pulse = cursor.querySelector('span')! as HTMLSpanElement;
  Object.assign(pulse.style, {
    position: 'absolute',
    left: '-5px',
    top: '-5px',
    width: '20px',
    height: '20px',
    border: '1.5px solid rgba(98,84,231,.58)',
    borderRadius: '999px',
    opacity: '0',
    transform: 'scale(.45)',
    transition: 'transform 150ms ease-out, opacity 150ms ease-out',
  });
  document.documentElement.append(cursor);
  return cursor;
}

export async function showActionCursor(
  document: Document,
  window: Window,
  target: Element,
): Promise<void> {
  const cursor = ensureCursor(document);
  const rect = target.getBoundingClientRect();
  const x = Math.max(4, Math.min(window.innerWidth - 18, rect.left + rect.width / 2));
  const y = Math.max(4, Math.min(window.innerHeight - 22, rect.top + rect.height / 2));
  cursor.style.opacity = '1';
  cursor.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 240));

  const pulse = cursor.querySelector('span')! as HTMLSpanElement;
  pulse.style.opacity = '0.58';
  pulse.style.transform = 'scale(1.05)';
  await new Promise<void>((resolve) => window.setTimeout(resolve, 190));
  pulse.style.opacity = '0';
  pulse.style.transform = 'scale(.45)';
  window.setTimeout(() => {
    cursor.style.opacity = '0';
  }, 260);
}

export const ensureCursorForTest = ensureCursor;

/** Move the agent cursor to the real dispatch point (viewport CSS pixels). */
export async function moveCursorTo(document: Document, window: Window, x: number, y: number): Promise<void> {
  const cursor = ensureCursor(document);
  cursor.style.opacity = '1';
  cursor.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
  window.setTimeout(() => {
    cursor.style.opacity = '0';
  }, 700);
}

export function hideCursor(document: Document): void {
  const cursor = document.getElementById(CURSOR_ID);
  if (cursor instanceof HTMLElement) cursor.style.opacity = '0';
}
