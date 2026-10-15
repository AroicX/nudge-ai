// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { sendExtensionMessage } from './runtime';

describe('sendExtensionMessage', () => {
  it('rejects invalid messages before they reach Chrome', async () => {
    const sendMessage = vi.fn();

    await expect(
      sendExtensionMessage({ type: 'page.execute', requestId: 'request-1' }, { sendMessage }),
    ).rejects.toThrow('Invalid extension message');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends validated messages', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const message = { type: 'sidepanel.open', requestId: 'request-1' } as const;

    await expect(sendExtensionMessage(message, { sendMessage })).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledWith(message);
  });
});
