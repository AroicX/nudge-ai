import { ProviderSelectionSchema, type ProviderSelection } from '@nudge/contracts';

import type { DecisionProvider } from './decision-provider';

export class ProviderRouter {
  constructor(
    private readonly openai: () => DecisionProvider,
    private readonly ollama: (baseUrl: string, model: string) => DecisionProvider,
  ) {}

  create(value: ProviderSelection): DecisionProvider {
    const selection = ProviderSelectionSchema.parse(value);
    return selection.provider === 'openai'
      ? this.openai()
      : this.ollama(selection.baseUrl, selection.model);
  }
}
