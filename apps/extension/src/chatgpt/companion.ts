import type { PlanMessageContent } from './text-route';
import { PlannerResponseSchema, ScopeResponseSchema, type PlannerRequest, type ScopeRequest } from '@nudge/contracts';
export const CHATGPT_HOST = 'com.nudge.chatgpt';

export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void; removeListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void; removeListener(listener: () => void): void };
}

export interface ChatGptAccount {
  id: string;
  label: string;
  email: string;
  planUsage: boolean;
  signedIn: boolean;
}

export interface ChatGptStatus {
  hostReady: boolean;
  activeAccountId?: string;
  accounts: ChatGptAccount[];
}

interface HostEnvelope {
  result?: unknown;
  v: 1;
  id: string;
  type: string;
  message?: string;
  text?: string;
  account?: ChatGptAccount;
  accounts?: ChatGptAccount[];
  activeAccountId?: string;
  models?: Array<{ slug: string; displayName: string }>;
  revocationConfirmed?: boolean;
  code?: string;
}

export class ChatGptCompanion {
  #port: NativePort | undefined;
  #waiters = new Map<string, { resolve(message: HostEnvelope): void; reject(error: Error): void; onDelta?(text: string): void }>();

  constructor(
    private readonly connect: () => NativePort,
    private readonly extensionId: string,
  ) {}

  async plan(accountId: string, model: string, request: PlannerRequest, signal: AbortSignal) {
    const response = await this.#request({ type: 'plan', accountId, model, request }, signal);
    return PlannerResponseSchema.parse(response.result);
  }

  async scope(accountId: string, model: string, request: ScopeRequest, signal: AbortSignal) {
    const response = await this.#request({ type: 'scope', accountId, model, request }, signal);
    return ScopeResponseSchema.parse(response.result);
  }

  async status(): Promise<ChatGptStatus> {
    const result = await this.#request({ type: 'status' });
    return {
      hostReady: true,
      ...(result.activeAccountId ? { activeAccountId: result.activeAccountId } : {}),
      accounts: result.accounts ?? [],
    };
  }

  async connectAccount(input: { accountId?: string; newAccount?: boolean; enablePlan?: boolean } = {}) {
    return this.#request({
      type: 'connect',
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.newAccount ? { newAccount: true } : {}),
      ...(input.enablePlan ? { enablePlan: true } : {}),
    });
  }

  async disconnectAccount(accountId: string) {
    return this.#request({ type: 'disconnect', accountId });
  }

  async selectAccount(accountId: string) {
    return this.#request({ type: 'select', accountId });
  }

  async models(accountId: string) {
    const result = await this.#request({ type: 'models', accountId });
    return result.models ?? [];
  }

  async respond(input: {
    accountId: string;
    model: string;
    instructions: string;
    messages: Array<{ role: 'user' | 'assistant' | 'developer'; content: PlanMessageContent }>;
    onDelta(text: string): void;
    signal: AbortSignal;
  }) {
    const id = crypto.randomUUID();
    const port = this.#ensure();
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        this.#waiters.delete(id);
        if (error) reject(error);
        else resolve();
      };
      if (input.signal.aborted) {
        finish(new Error('Stopped'));
        return;
      }
      input.signal.addEventListener(
        'abort',
        () => {
          port.postMessage({ v: 1, extensionId: this.extensionId, id: crypto.randomUUID(), type: 'cancel', targetId: id });
          finish(new Error('Stopped'));
        },
        { once: true },
      );
      this.#waiters.set(id, {
        resolve: (message) => {
          if (message.type === 'error') finish(new Error(message.message ?? 'ChatGPT plan request failed.'));
          else finish();
        },
        reject: finish,
        onDelta: input.onDelta,
      });
      port.postMessage({
        v: 1,
        extensionId: this.extensionId,
        id,
        type: 'respond',
        accountId: input.accountId,
        model: input.model,
        instructions: input.instructions,
        messages: input.messages,
      });
    });
  }

  #request(body: Record<string, unknown>, signal?: AbortSignal): Promise<HostEnvelope> {
    const id = crypto.randomUUID();
    if (signal?.aborted) return Promise.reject(new Error('Stopped'));
    const port = this.#ensure();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        port.postMessage({ v: 1, extensionId: this.extensionId, id: crypto.randomUUID(), type: 'cancel', targetId: id });
        this.#waiters.get(id)?.reject(new Error('Stopped'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', cancel);
        port.postMessage({ v: 1, extensionId: this.extensionId, id: crypto.randomUUID(), type: 'cancel', targetId: id });
        this.#waiters.delete(id);
        reject(new Error('The ChatGPT companion did not respond. Check that it is installed, then try again.'));
      }, body.type === 'connect' ? 10 * 60 * 1000 : body.type === 'plan' || body.type === 'scope' ? 120_000 : 30_000);
      this.#waiters.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          this.#waiters.delete(id);
          if (message.type === 'error') reject(new Error(message.message ?? 'ChatGPT companion request failed.'));
          else resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          this.#waiters.delete(id);
          reject(error);
        },
      });
      port.postMessage({ v: 1, extensionId: this.extensionId, id, ...body });
    });
  }

  #ensure() {
    if (this.#port) return this.#port;
    let port: NativePort;
    try {
      port = this.connect();
    } catch {
      throw new Error('Install the Nudge ChatGPT companion, then reload the extension. The setup is in full-screen settings.');
    }
    const onMessage = (message: unknown) => {
      const envelope = message as HostEnvelope;
      if (!envelope || envelope.v !== 1 || typeof envelope.id !== 'string') return;
      const waiter = this.#waiters.get(envelope.id);
      if (!waiter) return;
      if (envelope.type === 'delta' && typeof envelope.text === 'string') {
        waiter.onDelta?.(envelope.text);
        return;
      }
      waiter.resolve(envelope);
    };
    const onDisconnect = () => {
      this.#port = undefined;
      for (const waiter of this.#waiters.values())
        waiter.reject(new Error('Could not reach the ChatGPT companion. Open full-screen settings for setup instructions, then reload the extension.'));
      this.#waiters.clear();
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    this.#port = port;
    return port;
  }
}
