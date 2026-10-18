import { MODELS_URL } from './constants';

export interface PlanModel {
  slug: string;
  displayName: string;
}

export class PlanRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus?: number,
    readonly requestId?: string,
    readonly param?: string,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return (
      this.code === 'subscription_sharing_usage_unavailable' ||
      this.code === 'subscription_sharing_user_unavailable' ||
      (this.code === 'admission' && this.httpStatus === 503)
    );
  }
  get needsRefresh(): boolean {
    return this.httpStatus === 401 && this.code !== 'subscription_sharing_user_not_eligible';
  }
}

export function parseModelList(body: unknown): PlanModel[] {
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models))
    throw new PlanRequestError(
      'ChatGPT did not return a plan model list.',
      'invalid_model_list',
    );
  const visible: PlanModel[] = [];
  for (const model of models) {
    if (!model || typeof model !== 'object') continue;
    const record = model as { visibility?: unknown; slug?: unknown; display_name?: unknown };
    if (record.visibility !== 'list') continue;
    if (typeof record.slug !== 'string' || typeof record.display_name !== 'string') continue;
    visible.push({ slug: record.slug, displayName: record.display_name });
  }
  return visible;
}

export interface ResponseInput {
  role: 'user' | 'assistant' | 'developer';
  content: string;
}

export function responsesBody(input: {
  model: string;
  instructions: string;
  messages: ResponseInput[];
}): string {
  return JSON.stringify({
    model: input.model,
    instructions: input.instructions,
    input: input.messages.map((message) => ({ role: message.role, content: message.content })),
    store: false,
    stream: true,
  });
}

export function explainPlanError(error: PlanRequestError): string {
  switch (error.code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return 'Usage limit reached. Review your ChatGPT plan or this app’s limit in ChatGPT settings. Nudge will not switch this request to API billing.';
    case 'subscription_sharing_user_not_eligible':
      return 'ChatGPT plan usage is not available for this account or workspace.';
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return 'ChatGPT plan usage could not be checked. Try again later.';
    case 'subscription_sharing_unsupported_capability':
      return 'This text request uses a capability ChatGPT plan access does not support.';
    case 'subscription_sharing_route_not_supported':
      return 'ChatGPT plan access refused this request route.';
    case 'subscription_sharing_invalid_user':
    case 'invalid_grant':
      return 'ChatGPT access needs to be connected again.';
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context':
      return 'ChatGPT plan permission was not granted for this connection.';
    case 'admission':
      if (error.httpStatus === 401) return 'ChatGPT did not accept this connection. Check the selected account.';
      if (error.httpStatus === 403) return 'ChatGPT blocked this request because of an account or region restriction.';
      return 'ChatGPT plan routing is temporarily unavailable.';
    default:
      return 'ChatGPT plan request failed.';
  }
}

export function parseHttpError(status: number, body: unknown, requestId?: string): PlanRequestError {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const nested = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : undefined;
  const code =
    (typeof nested?.code === 'string' && nested.code) ||
    (typeof record.detail === 'string' ? 'admission' : 'request_failed');
  const param = typeof nested?.param === 'string' ? nested.param : undefined;
  const error = new PlanRequestError(explainPlanError(new PlanRequestError('', code, status, requestId, param)), code, status, requestId, param);
  return error;
}

export async function listPlanModels(accessToken: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(MODELS_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal,
  });
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw parseHttpError(response.status, body, requestId);
  return parseModelList(body);
}

export interface StreamEvent {
  output?: unknown[];
  type: 'delta' | 'completed' | 'failed' | 'incomplete' | 'output';
  text?: string;
  error?: PlanRequestError;
}

export function consumeSse(chunk: string, carry: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const text = carry + chunk;
  const blocks = text.split(/\n\n/);
  const rest = blocks.pop() ?? '';
  const events = blocks.flatMap((block) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    return data.length ? [{ event, data: data.join('\n') }] : [];
  });
  return { events, rest };
}

export function eventFromSse(event: string, data: string): StreamEvent | undefined {
  if (!data || data === '[DONE]') return undefined;
  const body = JSON.parse(data) as {
    type?: string;
    delta?: string;
    item?: unknown;
    response?: { output?: unknown[]; error?: { code?: string; message?: string; param?: string } };
    error?: { code?: string; message?: string; param?: string };
  };
  const type = body.type ?? event;
  if (type === 'response.output_text.delta' && typeof body.delta === 'string')
    return { type: 'delta', text: body.delta };
  if (type === 'response.output_item.done' && body.item) return { type: 'output', output: [body.item] };
  if (type === 'response.completed') return { type: 'completed', output: body.response?.output ?? [] };
  if (type === 'response.incomplete')
    return { type: 'incomplete', error: new PlanRequestError('The ChatGPT reply was incomplete.', 'incomplete') };
  if (type === 'response.failed' || type === 'error') {
    const info = body.response?.error ?? body.error;
    const code = info?.code ?? 'response_failed';
    const status = code === 'subscription_sharing_usage_limit_exceeded' ? 429 : undefined;
    const failure = new PlanRequestError('', code, status, undefined, info?.param);
    failure.message = explainPlanError(failure);
    return { type: 'failed', error: failure };
  }
  return undefined;
}
