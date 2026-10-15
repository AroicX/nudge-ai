import {
  AgentStepResponseSchema,
  type AgentStepRequest,
  type AgentStepResponse,
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
}
