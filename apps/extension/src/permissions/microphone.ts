export type MicrophoneState = 'granted' | 'denied' | 'dismissed' | 'unavailable';

interface ProbeDependencies {
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  getPermissionState?: () => Promise<PermissionState | undefined>;
}

interface SetupDependencies {
  getUrl(): string;
  createTab(options: { url: string }): Promise<unknown>;
}

async function browserMicrophonePermission(): Promise<PermissionState | undefined> {
  if (!navigator.permissions?.query) return undefined;
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return undefined;
  }
}

export async function probeMicrophone(
  dependencies: ProbeDependencies = {
    getUserMedia: navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices),
    getPermissionState: browserMicrophonePermission,
  },
): Promise<MicrophoneState> {
  if (!dependencies.getUserMedia) return 'unavailable';
  try {
    const stream = await dependencies.getUserMedia({ audio: true });
    const liveAudio = stream.getAudioTracks().some((track) => track.readyState === 'live');
    stream.getTracks().forEach((track) => track.stop());
    return liveAudio || stream.getAudioTracks().length > 0 ? 'granted' : 'unavailable';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      const state = await dependencies.getPermissionState?.();
      return state === 'denied' ? 'denied' : 'dismissed';
    }
    if (error instanceof DOMException && ['NotFoundError', 'NotReadableError'].includes(error.name)) {
      return 'unavailable';
    }
    return 'unavailable';
  }
}

export async function openMicrophoneSetup(
  dependencies: SetupDependencies = {
    getUrl: () => browser.runtime.getURL('/microphone.html' as never),
    createTab: (options) => browser.tabs.create(options),
  },
): Promise<void> {
  await dependencies.createTab({ url: dependencies.getUrl() });
}
