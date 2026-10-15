import type { AgentStepRequest, AgentStepResponse } from '@nudge/contracts';

import type { DecisionProvider } from './decision-provider';

export class DeterministicDecisionProvider implements DecisionProvider {
  readonly #handler: (request: AgentStepRequest) => AgentStepResponse | Promise<AgentStepResponse>;

  constructor(
    handler: (request: AgentStepRequest) => AgentStepResponse | Promise<AgentStepResponse>,
  ) {
    this.#handler = handler;
  }

  async step(request: AgentStepRequest, signal: AbortSignal): Promise<AgentStepResponse> {
    if (signal.aborted) throw signal.reason;
    return this.#handler(request);
  }
}
