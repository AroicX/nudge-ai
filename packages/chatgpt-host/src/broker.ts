import { HostRequestSchema, type HostRequest } from './framing';
import type { ChatGptRuntime } from './runtime';

export interface HostIO {
  send(message: unknown): void;
  allowedExtensionIds: string[];
}

export function createBroker(runtime: ChatGptRuntime, io: HostIO) {
  const aborts = new Map<string, AbortController>();
  const allowed = new Set(io.allowedExtensionIds);
  return {
    async handle(message: unknown) {
      const parsed = HostRequestSchema.safeParse(message);
      if (!parsed.success) {
        io.send({ v: 1, id: 'invalid', type: 'error', code: 'invalid_message', message: 'The companion rejected an invalid message.' });
        return;
      }
      const request = parsed.data;
      if (!allowed.has(request.extensionId)) {
        io.send({ v: 1, id: request.id, type: 'error', code: 'forbidden_extension', message: 'This Nudge companion is not registered for that extension.' });
        return;
      }
      try {
        await dispatch(runtime, io, aborts, request);
      } catch (error) {
        const controller = aborts.get(request.id);
        aborts.delete(request.id);
        controller?.abort();
        if (controller?.signal.aborted && request.type === 'respond') return;
        io.send({
          v: 1,
          id: request.id,
          type: 'error',
          code: 'failed',
          message: error instanceof Error ? error.message : 'ChatGPT companion request failed.',
        });
      }
    },
    cancelAll() {
      for (const controller of aborts.values()) controller.abort();
      runtime.cancelConnect();
    },
  };
}

async function dispatch(
  runtime: ChatGptRuntime,
  io: HostIO,
  aborts: Map<string, AbortController>,
  request: HostRequest,
) {
  if (request.type === 'cancel') {
    aborts.get(request.targetId)?.abort();
    runtime.cancelConnect();
    io.send({ v: 1, id: request.id, type: 'cancelled', targetId: request.targetId });
    return;
  }
  if (request.type === 'status') {
    io.send({ v: 1, id: request.id, type: 'status', ...runtime.status() });
    return;
  }
  if (request.type === 'plan' || request.type === 'scope') {
    const controller = new AbortController();
    aborts.set(request.id, controller);
    try {
      const result = await runtime.browserStep(request, controller.signal);
      if (!controller.signal.aborted) io.send({ v: 1, id: request.id, type: 'browser_result', result });
    } finally { aborts.delete(request.id); }
    return;
  }
  if (request.type === 'connect') {
    const account = await runtime.connect({
      ...(request.accountId ? { accountId: request.accountId } : {}),
      ...(request.newAccount ? { newAccount: true } : {}),
      ...(request.enablePlan ? { enablePlan: true } : {}),
    });
    io.send({ v: 1, id: request.id, type: 'connected', account, ...runtime.status() });
    return;
  }
  if (request.type === 'disconnect') {
    const result = await runtime.disconnect(request.accountId);
    io.send({
      v: 1,
      id: request.id,
      type: 'disconnected',
      revocationConfirmed: result.revocationConfirmed,
      account: result.account,
      ...runtime.status(),
    });
    return;
  }
  if (request.type === 'select') {
    runtime.select(request.accountId);
    io.send({ v: 1, id: request.id, type: 'status', ...runtime.status() });
    return;
  }
  if (request.type === 'models') {
    const controller = new AbortController();
    aborts.set(request.id, controller);
    const models = await runtime.models(request.accountId, controller.signal);
    aborts.delete(request.id);
    io.send({ v: 1, id: request.id, type: 'models', models });
    return;
  }
  const controller = new AbortController();
  aborts.set(request.id, controller);
  await runtime.respond(
    {
      accountId: request.accountId,
      model: request.model,
      instructions: request.instructions,
      messages: request.messages,
      onDelta: (text) => io.send({ v: 1, id: request.id, type: 'delta', text }),
    },
    controller.signal,
  );
  aborts.delete(request.id);
  if (!controller.signal.aborted) io.send({ v: 1, id: request.id, type: 'completed' });
}
