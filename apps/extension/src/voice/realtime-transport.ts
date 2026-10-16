import type { VoiceEvent, VoiceSessionConfig, VoiceToolResult } from '@nudge/contracts';
import type { VoiceEventListener, VoiceTransport } from '@nudge/core';

import { parseRealtimeEvent } from './realtime-events';

interface DataChannelLike {
  readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message',
    listener: (event: Event | MessageEvent<string>) => void,
  ): void;
}

interface PeerLike {
  addTrack(track: MediaStreamTrack, stream: MediaStream): void;
  createDataChannel(label: string): DataChannelLike;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
  ontrack: ((event: RTCTrackEvent) => void) | null;
}

export interface RealtimeTransportDependencies {
  getUserMedia(): Promise<MediaStream>;
  createPeer(): PeerLike;
  createAudio(): HTMLAudioElement;
  exchangeSdp(input: { offer: string; clientSecret: string; model: string }): Promise<string>;
}

export function createRealtimeVoiceTransport(
  dependencies: RealtimeTransportDependencies,
): VoiceTransport {
  const listeners = new Set<VoiceEventListener>();
  let peer: PeerLike | undefined;
  let channel: DataChannelLike | undefined;
  let stream: MediaStream | undefined;
  let audio: HTMLAudioElement | undefined;
  const emit = (event: VoiceEvent) => listeners.forEach((listener) => listener(event));
  const send = (event: unknown) => {
    if (channel?.readyState !== 'open') throw new Error('Voice connection is not ready.');
    channel.send(JSON.stringify(event));
  };

  return {
    async connect(config: VoiceSessionConfig) {
      if (peer) return;
      emit({ type: 'state', state: 'connecting' });
      const localStream = await dependencies.getUserMedia();
      stream = localStream;
      const localPeer = dependencies.createPeer();
      peer = localPeer;
      audio = dependencies.createAudio();
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      const playRemote = () => {
        const remoteAudio = audio;
        if (!remoteAudio || peer !== localPeer) return;
        void remoteAudio.play().catch(() => {
          emit({ type: 'state', state: 'failed' });
          emit({
            type: 'error',
            message: 'Chrome blocked AI voice playback. Start the voice call again.',
          });
        });
      };
      localPeer.ontrack = (event) => {
        const remoteAudio = audio;
        if (!remoteAudio || peer !== localPeer) return;
        remoteAudio.srcObject = event.streams[0] ?? null;
        playRemote();
      };
      localStream.getTracks().forEach((track) => localPeer.addTrack(track, localStream));
      channel = localPeer.createDataChannel('oai-events');
      channel.addEventListener('message', (raw) => {
        if (!('data' in raw)) return;
        try {
          const providerEvent = JSON.parse(raw.data) as { type?: unknown };
          const events = parseRealtimeEvent(providerEvent);
          if (events.some((event) => event.type === 'speech.started' && event.role === 'user')) {
            audio?.pause();
            if (audio) audio.currentTime = 0;
          }
          if (providerEvent.type === 'output_audio_buffer.started') playRemote();
          events.forEach(emit);
        } catch {
          emit({ type: 'error', message: 'Realtime event was invalid.' });
        }
      });
      const offer = await localPeer.createOffer();
      await localPeer.setLocalDescription(offer);
      const answer = await dependencies.exchangeSdp({
        offer: offer.sdp ?? '',
        clientSecret: config.clientSecret,
        model: config.model,
      });
      await localPeer.setRemoteDescription({ type: 'answer', sdp: answer });
      emit({ type: 'state', state: 'listening' });
    },
    async disconnect() {
      channel?.close();
      channel = undefined;
      stream?.getTracks().forEach((track) => track.stop());
      stream = undefined;
      peer?.close();
      peer = undefined;
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
        audio = undefined;
      }
      emit({ type: 'state', state: 'ended' });
    },
    interrupt() {
      audio?.pause();
      if (audio) audio.currentTime = 0;
      send({ type: 'response.cancel' });
      send({ type: 'output_audio_buffer.clear' });
      emit({ type: 'state', state: 'interrupted' });
    },
    setMuted(muted: boolean) {
      stream?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    sendText(text: string) {
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
      send({ type: 'response.create' });
    },
    sendToolResult(callId: string, result: VoiceToolResult) {
      send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result),
        },
      });
      send({ type: 'response.create' });
    },
    subscribe(listener: VoiceEventListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function browserRealtimeDependencies(): RealtimeTransportDependencies {
  return {
    getUserMedia: () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      }),
    createPeer: () => new RTCPeerConnection(),
    createAudio: () =>
      document.body.appendChild(Object.assign(document.createElement('audio'), { hidden: true })),
    exchangeSdp: async ({ offer, clientSecret, model }) => {
      const response = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${clientSecret}`, 'content-type': 'application/sdp' },
          body: offer,
        },
      );
      if (!response.ok) throw new Error('Realtime connection failed.');
      return response.text();
    },
  };
}
