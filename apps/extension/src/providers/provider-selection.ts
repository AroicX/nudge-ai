import type { ProviderSelection } from '@nudge/contracts';

export interface ProviderHealth {
  openai: { available: boolean };
  ollama: { available: boolean; models: string[]; error?: string };
}

export function reconcileProviderSelection(
  selection: ProviderSelection,
  health: ProviderHealth,
): ProviderSelection {
  if (selection.provider !== 'ollama') return selection;
  if (!health.ollama.available || health.ollama.models.length === 0) {
    return selection;
  }
  if (health.ollama.models.includes(selection.model)) return selection;
  return { ...selection, model: health.ollama.models[0]! };
}
