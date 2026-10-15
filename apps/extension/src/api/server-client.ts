import {
  AgentStepResponseSchema,
  VoiceSessionConfigSchema,
  type AgentStepRequest,
  type AgentStepResponse,
  type ProviderSelection,
} from '@nudge/contracts';

export class ServerClient {
  constructor(
    private readonly baseUrl = 'http://127.0.0.1:4317',
    private readonly pairingSecret = '',
  ) {}

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    headers.set('x-nudge-pairing-secret', this.pairingSecret);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      ...(signal ? { signal } : {}),
      headers,
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.error ?? `Backend error ${response.status}`,
      );
    return response;
  }

  async step(request: AgentStepRequest, signal: AbortSignal): Promise<AgentStepResponse> {
    const response = await this.request(
      '/api/agent/step',
      { method: 'POST', body: JSON.stringify(request) },
      signal,
    );
    return AgentStepResponseSchema.parse(await response.json());
  }

  async setProviderKey(apiKey: string): Promise<void> {
    await this.request('/api/settings/provider-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    });
  }

  async clearProviderKey(): Promise<void> {
    await this.request('/api/settings/provider-key', { method: 'DELETE' });
  }

  async setProviderSelection(selection: ProviderSelection): Promise<void> {
    await this.request('/api/settings/provider', {
      method: 'PUT',
      body: JSON.stringify(selection),
    });
  }

  async getProviderHealth(baseUrl = 'http://127.0.0.1:11434') {
    const response = await this.request(
      `/api/providers/health?baseUrl=${encodeURIComponent(baseUrl)}`,
      { method: 'GET' },
    );
    return (await response.json()) as {
      openai: { available: boolean };
      ollama: { available: boolean; models: string[]; error?: string };
    };
  }

  async issueRealtimeSession(signal: AbortSignal) {
    const response = await this.request(
      '/api/realtime/session',
      { method: 'POST', body: JSON.stringify({ voice: 'marin' }) },
      signal,
    );
    return VoiceSessionConfigSchema.parse(await response.json());
  }

  async transcribe(audio: Blob, signal: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('audio', audio, `speech.${audio.type.includes('mp4') ? 'mp4' : 'webm'}`);
    const response = await fetch(`${this.baseUrl}/api/audio/transcribe`, {
      method: 'POST',
      headers: { 'x-nudge-pairing-secret': this.pairingSecret },
      body: form,
      signal,
    });
    if (!response.ok) throw new Error('Could not transcribe audio.');
    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== 'string') throw new Error('Transcription response was invalid.');
    return body.text;
  }
}
