import type { PersistedTurn } from '@nudge/contracts';

export interface SavedChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  generation: number;
}
export interface MemoryFact {
  key: string;
  value: string;
  source: string;
  updatedAt: string;
}
export interface MemoryDocument {
  id: string;
  filename: string;
  text: string;
  source: string;
  createdAt: string;
}
export class MemoryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}
  private async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/memory${path}`, {
      method,
      headers: {
        'x-nudge-pairing-secret': this.secret,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(body !== undefined
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
      signal: signal ?? AbortSignal.timeout(path === '/chat' ? 180_000 : 20_000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? `Local memory request failed (${response.status}).`);
    return result as T;
  }
  async chats() {
    return (await this.request<{ chats: SavedChat[] }>('/chats')).chats;
  }
  preferences() {
    return this.request<{ autoRemember: boolean; localDiagnostics: boolean }>('/preferences');
  }
  savePreferences(value: { autoRemember: boolean; localDiagnostics: boolean }) {
    return this.request<{ autoRemember: boolean; localDiagnostics: boolean }>(
      '/preferences',
      'PUT',
      value,
    );
  }
  async createChat(title = 'New chat', id?: string) {
    return (
      await this.request<{ chat: SavedChat }>('/chats', 'POST', { title, ...(id ? { id } : {}) })
    ).chat;
  }
  async deleteChat(id: string) {
    await this.request(`/chats/${encodeURIComponent(id)}`, 'DELETE');
  }
  async renameChat(id: string, title: string) {
    await this.request(`/chats/${encodeURIComponent(id)}`, 'PATCH', { title });
  }
  messages(id: string) {
    return this.request<{ messages: PersistedTurn[]; generation: number }>(
      `/chats/${encodeURIComponent(id)}/messages`,
    );
  }
  saveMessages(id: string, messages: PersistedTurn[], generation: number) {
    return this.request<{ messages: PersistedTurn[]; generation: number }>(
      `/chats/${encodeURIComponent(id)}/messages`,
      'PUT',
      { messages, generation },
    );
  }
  clearMessages(id: string) {
    return this.request<{ messages?: PersistedTurn[]; generation: number }>(
      `/chats/${encodeURIComponent(id)}/messages`,
      'DELETE',
    );
  }
  async facts() {
    return (await this.request<{ facts: MemoryFact[] }>('/facts')).facts;
  }
  async saveFact(key: string, value: string) {
    await this.request(`/facts/${encodeURIComponent(key)}`, 'PUT', { value, source: 'user' });
  }
  async deleteFact(key: string) {
    await this.request(`/facts/${encodeURIComponent(key)}`, 'DELETE');
  }
  async documents() {
    return (await this.request<{ documents: MemoryDocument[] }>('/documents')).documents;
  }
  async saveDocument(filename: string, text: string) {
    await this.request('/documents', 'POST', { filename, text });
  }
  async uploadDocument(file: File) {
    const form = new FormData();
    form.append('file', file);
    await this.request('/documents/upload', 'POST', form);
  }
  async deleteDocument(id: string) {
    await this.request(`/documents/${encodeURIComponent(id)}`, 'DELETE');
  }
  chat(chatId: string, text: string, provider: 'openai' | 'ollama', signal?: AbortSignal) {
    return this.request<{
      text: string;
      sources?: Array<{ kind: string; id: string; title: string; source: string }>;
    }>('/chat', 'POST', { chatId, text, provider }, signal);
  }
}
