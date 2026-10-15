import type { AgentStepRequest, AgentStepResponse } from '@nudge/contracts';

export interface DecisionProvider {
  step(request: AgentStepRequest, signal: AbortSignal): Promise<AgentStepResponse>;
  close?(): void | Promise<void>;
}

export type DecisionProviderFactory = (apiKey: string) => DecisionProvider;
