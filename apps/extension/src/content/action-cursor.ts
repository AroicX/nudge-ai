const CURSOR_ID = 'nudge-action-cursor';

function ensureCursor(document: Document): HTMLDivElement {
  const existing = document.getElementById(CURSOR_ID);
  if (existing instanceof HTMLDivElement) return existing;

  const cursor = document.createElement('div');
  cursor.id = CURSOR_ID;
  cursor.dataset.nudgeRoot = 'action-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = `
    <svg viewBox="0 0 28 32" width="28" height="32" aria-hidden="true">
      <path d="M3 2.5v23.2l6.1-5.5 4.2 9.1 4.4-2-4.1-8.8h8.2L3 2.5Z" fill="#fff" stroke="#171827" stroke-width="2.4" stroke-linejoin="round"/>
    </svg>
    <span></span>
  `;
  Object.assign(cursor.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: '0',
    top: '0',
    width: '28px',
    height: '32px',
    pointerEvents: 'none',
    opacity: '0',
    transform: 'translate3d(-40px,-40px,0)',
    transition: 'transform 220ms cubic-bezier(.2,.8,.2,1), opacity 100ms ease',
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.28))',
  });
  const pulse = cursor.querySelector('span')! as HTMLSpanElement;
  Object.assign(pulse.style, {
    position: 'absolute',
    left: '-8px',
    top: '-8px',
    width: '32px',
    height: '32px',
    border: '2px solid #6254e7',
    borderRadius: '999px',
    opacity: '0',
    transform: 'scale(.35)',
    transition: 'transform 180ms ease-out, opacity 180ms ease-out',
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
  const x = Math.max(4, Math.min(window.innerWidth - 28, rect.left + rect.width / 2));
  const y = Math.max(4, Math.min(window.innerHeight - 32, rect.top + rect.height / 2));
  cursor.style.opacity = '1';
  cursor.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 240));

  const pulse = cursor.querySelector('span')! as HTMLSpanElement;
  pulse.style.opacity = '0.9';
  pulse.style.transform = 'scale(1.25)';
  await new Promise<void>((resolve) => window.setTimeout(resolve, 190));
  pulse.style.opacity = '0';
  pulse.style.transform = 'scale(.35)';
  window.setTimeout(() => {
    cursor.style.opacity = '0';
  }, 260);
}
