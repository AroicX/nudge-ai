// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createRealtimeVoiceTransport } from './realtime-transport';

function setup(play = vi.fn().mockResolvedValue(undefined)) {
  const sent: string[] = [];
  let message: ((event: MessageEvent<string>) => void) | undefined;
  const track = { enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const channel = {
    readyState: 'open',
    send: (data: string) => sent.push(data),
    close: vi.fn(),
    addEventListener: (type: string, listener: (event: MessageEvent<string>) => void) => {
      if (type === 'message') message = listener;
    },
  };
  const peer: {
    addTrack(track: MediaStreamTrack, stream: MediaStream): void;
    createDataChannel(): typeof channel;
    createOffer(): Promise<RTCSessionDescriptionInit>;
    setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
    setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
    close(): void;
    ontrack: ((event: RTCTrackEvent) => void) | null;
  } = {
    addTrack: vi.fn<(track: MediaStreamTrack, stream: MediaStream) => void>(),
    createDataChannel: () => channel,
    createOffer: vi.fn<() => Promise<RTCSessionDescriptionInit>>().mockResolvedValue({ type: 'offer', sdp: 'offer' }),
    setLocalDescription: vi.fn<(description: RTCSessionDescriptionInit) => Promise<void>>().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn<(description: RTCSessionDescriptionInit) => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn<() => void>(),
    ontrack: null,
  };
  const audio = Object.assign(document.createElement('audio'), {
    pause: vi.fn(),
    play,
  });
  const transport = createRealtimeVoiceTransport({
    getUserMedia: async () => stream,
    createPeer: () => peer,
    createAudio: () => audio,
    exchangeSdp: vi.fn().mockResolvedValue('answer'),
  });
  return {
    transport,
    sent,
    track,
    peer,
    channel,
    audio,
    emit: (value: unknown) =>
      message?.(new MessageEvent('message', { data: JSON.stringify(value) })),
  };
}

describe('realtime transport', () => {
  it('connects media and emits transcripts', async () => {
    const fixture = setup();
    const events: unknown[] = [];
    fixture.transport.subscribe((event) => events.push(event));
    await fixture.transport.connect({
      clientSecret: 'ephemeral',
      model: 'gpt-realtime',
      expiresAt: 123,
    });
    fixture.emit({ type: 'response.output_audio_transcript.done', transcript: 'Hello' });
    expect(fixture.peer.addTrack).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'transcript',
      role: 'assistant',
      text: 'Hello',
      final: true,
    });
  });

  it('starts remote AI audio playback when the WebRTC track arrives', async () => {
    const fixture = setup();
    await fixture.transport.connect({
      clientSecret: 'ephemeral',
      model: 'gpt-realtime',
      expiresAt: 123,
    });

    fixture.peer.ontrack?.({ streams: [{} as MediaStream] } as unknown as RTCTrackEvent);

    expect(fixture.audio.srcObject).toBeTruthy();
    expect(fixture.audio.play).toHaveBeenCalledOnce();
  });

  it('reports when Chrome blocks remote AI audio playback', async () => {
    const fixture = setup(vi.fn().mockRejectedValue(new Error('blocked')));
    const events: unknown[] = [];
    fixture.transport.subscribe((event) => events.push(event));
    await fixture.transport.connect({
      clientSecret: 'ephemeral',
      model: 'gpt-realtime',
      expiresAt: 123,
    });

    fixture.peer.ontrack?.({ streams: [{} as MediaStream] } as unknown as RTCTrackEvent);
    await Promise.resolve();

    expect(events).toContainEqual({ type: 'state', state: 'failed' });
    expect(events).toContainEqual({
      type: 'error',
      message: 'Chrome blocked AI voice playback. Start the voice call again.',
    });
  });

  it('cancels generation and clears buffered output on interruption', async () => {
    const fixture = setup();
    await fixture.transport.connect({
      clientSecret: 'ephemeral',
      model: 'gpt-realtime',
      expiresAt: 123,
    });
    fixture.transport.interrupt();
    expect(fixture.sent.map((value) => JSON.parse(value))).toEqual([
      { type: 'response.cancel' },
      { type: 'output_audio_buffer.clear' },
    ]);
    expect(fixture.audio.pause).toHaveBeenCalled();
  });

  it('mutes and disconnects idempotently', async () => {
    const fixture = setup();
    await fixture.transport.connect({
      clientSecret: 'ephemeral',
      model: 'gpt-realtime',
      expiresAt: 123,
    });
    fixture.transport.setMuted(true);
    expect(fixture.track.enabled).toBe(false);
    await fixture.transport.disconnect('end');
    await fixture.transport.disconnect('again');
    expect(fixture.track.stop).toHaveBeenCalledOnce();
    expect(fixture.peer.close).toHaveBeenCalledOnce();
  });
});
