import type { PlannerRequest, PlannerResponse, ScopeRequest, ScopeResponse } from '@nudge/contracts';

export interface PlannerProvider {
  plan(request: PlannerRequest, signal: AbortSignal): Promise<PlannerResponse>;
  scope(request: ScopeRequest, signal: AbortSignal): Promise<ScopeResponse>;
  capabilities?(): Promise<{ tools: boolean; vision: boolean }>;
}

export type PlannerFactory = (providerOverride?: 'openai' | 'ollama') => PlannerProvider;

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
  const { screenshot: _screenshot, ...observation } = request.observation;
  return { ...request, observation };
}
