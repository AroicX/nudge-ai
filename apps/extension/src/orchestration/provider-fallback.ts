export interface ProviderFallbackRequest {
  id: string;
  taskId: string;
  from: 'ollama';
  to: 'openai';
  reason: string;
  expiresAt: number;
}

interface Pending {
  request: ProviderFallbackRequest;
  resolve(value: 'approved' | 'declined'): void;
}

export class ProviderFallbackController {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number = Date.now) {}

  request(taskId: string, reason: string, ttlMs = 5 * 60_000) {
    const request: ProviderFallbackRequest = {
      id: crypto.randomUUID(),
      taskId,
      from: 'ollama',
      to: 'openai',
      reason,
      expiresAt: this.now() + ttlMs,
    };
    let resolve!: Pending['resolve'];
    const decision = new Promise<'approved' | 'declined'>((done) => {
      resolve = done;
    });
    this.pending.set(request.id, { request, resolve });
    return { request, decision };
  }

  approveFallback(requestId: string, taskId: string): boolean {
    return this.settle(requestId, taskId, 'approved');
  }

  declineFallback(requestId: string, taskId: string): boolean {
    return this.settle(requestId, taskId, 'declined');
  }

  private settle(
    requestId: string,
    taskId: string,
    decision: 'approved' | 'declined',
  ): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.request.taskId !== taskId) return false;
    const expired = pending.request.expiresAt <= this.now();
    this.pending.delete(requestId);
    pending.resolve(expired ? 'declined' : decision);
    return !expired;
  }
}
