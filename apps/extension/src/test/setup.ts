import { createElement } from 'react';
import { vi } from 'vitest';

vi.mock('orb-ui', () => ({
  Orb: ({ signal }: { signal?: { state?: string } }) =>
    createElement('span', { 'data-orb-state': signal?.state ?? 'idle' }),
}));

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
