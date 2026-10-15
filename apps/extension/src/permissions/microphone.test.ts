import { describe, expect, it, vi } from 'vitest';

import { openMicrophoneSetup, probeMicrophone } from './microphone';

function audioStream(...tracks: Array<{ stop(): void }>) {
  return {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

describe('microphone permissions', () => {
  it('probes the live permission even when setup was completed and stops every track', async () => {
    const first = { stop: vi.fn() };
    const second = { stop: vi.fn() };
    const getUserMedia = vi.fn().mockResolvedValue(audioStream(first, second));

    await expect(
      probeMicrophone({
        getUserMedia,
        getPermissionState: vi.fn().mockResolvedValue('granted'),
      }),
    ).resolves.toBe('granted');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it('distinguishes denied from dismissed NotAllowedError results', async () => {
    const error = new DOMException('Permission rejected', 'NotAllowedError');
    const getUserMedia = vi.fn().mockRejectedValue(error);

    await expect(
      probeMicrophone({
        getUserMedia,
        getPermissionState: vi.fn().mockResolvedValue('denied'),
      }),
    ).resolves.toBe('denied');
    await expect(
      probeMicrophone({
        getUserMedia,
        getPermissionState: vi.fn().mockResolvedValue('prompt'),
      }),
    ).resolves.toBe('dismissed');
  });

  it('returns unavailable without media devices', async () => {
    await expect(
      probeMicrophone({ getUserMedia: undefined, getPermissionState: vi.fn() }),
    ).resolves.toBe('unavailable');
  });

  it('opens the dedicated setup page', async () => {
    const createTab = vi.fn().mockResolvedValue(undefined);
    await openMicrophoneSetup({
      getUrl: () => 'chrome-extension://nudge/microphone.html',
      createTab,
    });
    expect(createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://nudge/microphone.html',
    });
  });
});
