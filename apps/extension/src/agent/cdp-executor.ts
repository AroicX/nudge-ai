import { parseKeyChord } from '@nudge/contracts';

import type { CdpPort } from './ports';

/** The only Chrome DevTools Protocol methods Nudge ever sends. Tool calls cannot reach any other. */
export const ALLOWED_CDP_METHODS = [
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Page.captureScreenshot',
] as const;
type AllowedMethod = (typeof ALLOWED_CDP_METHODS)[number];

interface Debuggee {
  tabId: number;
}

export interface DebuggerApi {
  attach(target: Debuggee, requiredVersion: string): Promise<void>;
  detach(target: Debuggee): Promise<void>;
  sendCommand(target: Debuggee, method: string, params?: Record<string, unknown>): Promise<unknown>;
  onDetach: {
    addListener(listener: (source: { tabId?: number }, reason: string) => void): void;
    removeListener(listener: (source: { tabId?: number }, reason: string) => void): void;
  };
}

export interface PermissionsApi {
  contains(permissions: { permissions: string[] }): Promise<boolean>;
}

const NAMED: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  F2: { key: 'F2', code: 'F2', vk: 113 },
};
const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

function describeKey(key: string, shift: boolean) {
  const named = NAMED[key];
  if (named) return named;
  const lower = key.toLowerCase();
  const code = /[a-z]/.test(lower) ? `Key${lower.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : '';
  const vk = /[a-z]/.test(lower) ? lower.toUpperCase().charCodeAt(0) : /\d/.test(key) ? key.charCodeAt(0) : 0;
  const produced = /[a-z]/i.test(key) && key.length === 1 ? (shift ? key.toUpperCase() : key.toLowerCase()) : key;
  return { key: produced, code, vk, text: produced };
}

export function createCdpExecutor(api: DebuggerApi, permissions: PermissionsApi): CdpPort & { send(method: string, params?: Record<string, unknown>): Promise<unknown> } {
  let attached: number | undefined;
  const lostListeners = new Set<(reason: string) => void>();

  api.onDetach.addListener((source, reason) => {
    if (source.tabId === undefined || source.tabId !== attached) return;
    attached = undefined;
    lostListeners.forEach((listener) => listener(reason));
  });

  const send = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (!(ALLOWED_CDP_METHODS as readonly string[]).includes(method)) throw new Error(`CDP method ${method} is not allowed.`);
    if (attached === undefined) throw new Error('Trusted input is not attached to a tab.');
    return api.sendCommand({ tabId: attached }, method as AllowedMethod, params);
  };

  const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });

  return {
    send,
    async available() {
      try {
        return await permissions.contains({ permissions: ['debugger'] });
      } catch {
        return false;
      }
    },
    async attach(tabId) {
      if (attached === tabId) return;
      if (attached !== undefined) await this.detach();
      try {
        await api.attach({ tabId }, '1.3');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          /already attached|another debugger/i.test(message)
            ? 'Chrome DevTools or another debugger is already attached to this tab. Close DevTools and try again.'
            : `Could not take control of this tab’s input: ${message}`,
        );
      }
      attached = tabId;
    },
    async detach() {
      const tabId = attached;
      attached = undefined;
      if (tabId !== undefined) await api.detach({ tabId }).catch(() => undefined);
    },
    async click(x, y, options = {}) {
      await mouse('mouseMoved', x, y, { button: 'none', buttons: 0 });
      const presses = options.double ? [1, 2] : [1];
      for (const clickCount of presses) {
        await mouse('mousePressed', x, y, { clickCount, buttons: 1 });
        await mouse('mouseReleased', x, y, { clickCount, buttons: 0 });
      }
    },
    async drag(from, to) {
      await mouse('mouseMoved', from.x, from.y, { button: 'none', buttons: 0 });
      await mouse('mousePressed', from.x, from.y, { clickCount: 1, buttons: 1 });
      const steps = 10;
      for (let index = 1; index <= steps; index += 1) {
        const x = from.x + ((to.x - from.x) * index) / steps;
        const y = from.y + ((to.y - from.y) * index) / steps;
        await mouse('mouseMoved', x, y, { buttons: 1 });
      }
      await mouse('mouseReleased', to.x, to.y, { clickCount: 1, buttons: 0 });
    },
    async key(chord) {
      const parsed = parseKeyChord(chord);
      if (!parsed) throw new Error(`Unsupported key ${chord}.`);
      const modifiers = parsed.modifiers.reduce((bits, name) => bits | (MODIFIER_BITS[name] ?? 0), 0);
      const shift = parsed.modifiers.includes('Shift');
      const described = describeKey(parsed.key, shift);
      const printable = described.text !== undefined && !(modifiers & (MODIFIER_BITS.Control! | MODIFIER_BITS.Meta! | MODIFIER_BITS.Alt!));
      const base = { modifiers, key: described.key, code: described.code, windowsVirtualKeyCode: described.vk };
      await send('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', ...base, ...(printable ? { text: described.text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async insertText(text) {
      await send('Input.insertText', { text });
    },
    async captureScreenshot() {
      const result = (await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })) as { data?: string };
      if (!result?.data) throw new Error('Screenshot failed.');
      return `data:image/jpeg;base64,${result.data}`;
    },
    attachedTabId: () => attached,
    onLost(listener) {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
  };
}
