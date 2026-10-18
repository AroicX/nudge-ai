import type {
  PlannerRequest,
  PlannerResponse,
  ProviderSelection,
  ScopeRequest,
  ScopeResponse,
} from '@nudge/contracts';

export interface PlannerProvider {
  readonly requestTimeoutMs?: number;
  plan(request: PlannerRequest, signal: AbortSignal): Promise<PlannerResponse>;
  scope(request: ScopeRequest, signal: AbortSignal): Promise<ScopeResponse>;
  capabilities?(): Promise<{ tools: boolean; vision: boolean }>;
}

export type PlannerFactory = (
  providerOverride?: 'openai' | 'ollama',
  context?: { apiKey: string },
) => PlannerProvider;

/** Browser steps stay on their saved provider. ChatGPT plan text never becomes an API call unless the caller passes an explicit OpenAI override. */
export function resolveBrowserProvider(
  selection: ProviderSelection,
  override: 'openai' | 'ollama' | undefined,
  localSelection: Extract<ProviderSelection, { provider: 'ollama' }> | undefined,
): Exclude<ProviderSelection, { provider: 'chatgpt' }> {
  if (override === 'openai') return { provider: 'openai' };
  if (override === 'ollama') {
    if (!localSelection)
      throw new Error('Ollama settings are not ready. Reopen Nudge or choose the local model again.');
    return localSelection;
  }
  if (selection.provider === 'chatgpt')
    throw new Error(
      'ChatGPT plan usage is only for text chat. This browser step was not sent to the OpenAI API.',
    );
  if (selection.provider === 'ollama') return selection;
  return { provider: 'openai' };
}

/** Remove JSON nulls produced by strict-mode optional fields so Zod sees absent keys. */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== null)
        .map(([key, child]) => [key, stripNulls(child)]),
    );
  }
  return value;
}

/** The planner never needs the image bytes inside the JSON text part. */
export function withoutScreenshotBytes(request: PlannerRequest): PlannerRequest {
  if (!request.observation?.screenshot) return request;
  const { screenshot, ...observation } = request.observation;
  return {
    ...request,
    observation: {
      ...observation,
      screenshot: { frame: screenshot.frame, dataUrl: 'data:image/jpeg;attached-separately' },
    },
  };
}

export function withoutScreenshot(request: PlannerRequest): PlannerRequest {
  if (!request.observation?.screenshot) return request;
  const observation = { ...request.observation };
  delete observation.screenshot;
  return { ...request, observation };
}
