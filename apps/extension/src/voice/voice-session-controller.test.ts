import type { VoiceEventListener, VoiceTransport } from '@nudge/core';
import { describe, expect, it, vi } from 'vitest';

import { VoiceSessionController } from './voice-session-controller';

function transportFixture() {
  let listener: VoiceEventListener = () => undefined;
  const transport: VoiceTransport = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    interrupt: vi.fn(),
    setMuted: vi.fn(),
    sendText: vi.fn(),
    sendToolResult: vi.fn(),
    subscribe(next) {
      listener = next;
      return () => undefined;
    },
  };
  return { transport, emit: listener };
}

describe('VoiceSessionController', () => {
  it('owns only one connecting session', async () => {
    const { transport } = transportFixture();
    const issue = vi
      .fn()
      .mockResolvedValue({ clientSecret: 'short', model: 'gpt-realtime', expiresAt: 10 });
    const controller = new VoiceSessionController(transport, issue);
    await Promise.all([controller.start(), controller.start()]);
    expect(issue).toHaveBeenCalledOnce();
    expect(transport.connect).toHaveBeenCalledOnce();
  });

  it('cleans up a connection that finishes after End Call', async () => {
    const { transport } = transportFixture();
    let resolve!: (value: { clientSecret: string; model: string; expiresAt: number }) => void;
    const issue = () =>
      new Promise<{ clientSecret: string; model: string; expiresAt: number }>((done) => {
        resolve = done;
      });
    const controller = new VoiceSessionController(transport, issue);
    const starting = controller.start();
    await controller.end();
    resolve({ clientSecret: 'short', model: 'gpt-realtime', expiresAt: 10 });
    await starting;
    expect(transport.connect).not.toHaveBeenCalled();
    expect(transport.disconnect).toHaveBeenCalled();
  });
});
