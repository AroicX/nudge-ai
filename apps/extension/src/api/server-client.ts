import {
  AgentStepResponseSchema,
  PlannerResponseSchema,
  ScopeResponseSchema,
  type PlannerRequest,
  type PlannerResponse,
  type ScopeRequest,
  type ScopeResponse,
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
    if (init.body !== undefined) headers.set('content-type', 'application/json');
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

  async step(
    request: AgentStepRequest,
    signal: AbortSignal,
    provider?: 'openai' | 'ollama',
  ): Promise<AgentStepResponse> {
    const response = await this.request(
      '/api/agent/step',
      {
        method: 'POST',
        body: JSON.stringify(request),
        ...(provider ? { headers: { 'x-nudge-provider': provider } } : {}),
      },
      signal,
    );
    return AgentStepResponseSchema.parse(await response.json());
  }

  async plan(
    request: PlannerRequest,
    signal: AbortSignal,
    provider?: 'openai' | 'ollama',
  ): Promise<PlannerResponse> {
    const response = await this.request(
      '/api/agent/plan',
      {
        method: 'POST',
        body: JSON.stringify(request),
        ...(provider ? { headers: { 'x-nudge-provider': provider } } : {}),
      },
      signal,
    );
    return PlannerResponseSchema.parse(await response.json());
  }

  async scope(
    request: ScopeRequest,
    signal: AbortSignal,
    provider?: 'openai' | 'ollama',
  ): Promise<ScopeResponse> {
    const response = await this.request(
      '/api/agent/scope',
      {
        method: 'POST',
        body: JSON.stringify(request),
        ...(provider ? { headers: { 'x-nudge-provider': provider } } : {}),
      },
      signal,
    );
    return ScopeResponseSchema.parse(await response.json());
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

  async localVoiceHealth(signal: AbortSignal): Promise<{ available: boolean; error?: string }> {
    return (await this.request('/api/local-voice/health', { method: 'GET' }, signal)).json();
  }

  async prepareLocalVoice(signal: AbortSignal): Promise<void> {
    await this.request('/api/local-voice/prepare', { method: 'POST', body: '{}' }, signal);
  }

  async localVoiceChat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await this.request(
      '/api/local-voice/chat',
      { method: 'POST', body: JSON.stringify({ messages }) },
      signal,
    );
    const body = (await response.json()) as { text: string };
    return body.text;
  }

  async localVoiceChatStream(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<string> {
    const response = await this.request(
      '/api/local-voice/chat-stream',
      { method: 'POST', body: JSON.stringify({ messages }) },
      signal,
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty local reply.');
    const decoder = new TextDecoder();
    let buffer = '',
      answer = '';
    try {
      while (true) {
        signal.throwIfAborted();
        const part = await reader.read();
        buffer += decoder.decode(part.value, { stream: !part.done });
        if (buffer.length > 65536) throw new Error('Invalid local reply.');
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const item = JSON.parse(line) as { text?: string; done?: boolean; error?: string };
          if (item.error) throw new Error(item.error);
          if (typeof item.text === 'string') {
            answer += item.text;
            if (answer.length > 2000) throw new Error('Local reply too long.');
            onText(item.text);
          }
          if (item.done) {
            if (!answer.trim()) throw new Error('Empty local reply.');
            return answer.trim();
          }
        }
        if (part.done) throw new Error('Local reply ended unexpectedly.');
      }
    } finally {
      await reader.cancel();
    }
  }

  async localVoiceSpeech(text: string, signal: AbortSignal): Promise<Blob> {
    return (
      await this.request(
        '/api/local-voice/speech',
        { method: 'POST', body: JSON.stringify({ text }) },
        signal,
      )
    ).blob();
  }

  async transcribe(audio: Blob, signal: AbortSignal, local = false): Promise<string> {
    const form = new FormData();
    form.append(
      'audio',
      audio,
      `speech.${audio.type.includes('wav') ? 'wav' : audio.type.includes('mp4') ? 'mp4' : 'webm'}`,
    );
    const response = await fetch(
      `${this.baseUrl}${local ? '/api/local-voice/transcribe' : '/api/audio/transcribe'}`,
      {
        method: 'POST',
        headers: { 'x-nudge-pairing-secret': this.pairingSecret },
        body: form,
        signal,
      },
    );
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.error ?? 'Could not transcribe audio.',
      );
    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== 'string') throw new Error('Transcription response was invalid.');
    return body.text;
  }
}
