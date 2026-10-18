import type { ProviderSelection } from '@nudge/contracts';
import { describe, expect, it } from 'vitest';

import { reconcileProviderSelection } from './provider-selection';

const ollamaSelection: ProviderSelection = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3',
};

describe('reconcileProviderSelection', () => {
  it('preserves local intent when Ollama has no installed models', () => {
    expect(
      reconcileProviderSelection(ollamaSelection, {
        openai: { available: true },
        ollama: { available: true, models: [] },
      }),
    ).toEqual(ollamaSelection);
  });

  it('uses an available Ollama model when the saved model was removed', () => {
    expect(
      reconcileProviderSelection(ollamaSelection, {
        openai: { available: true },
        ollama: { available: true, models: ['llama3.2'] },
      }),
    ).toEqual({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'llama3.2',
    });
  });

  it('preserves a valid selection', () => {
    expect(
      reconcileProviderSelection(ollamaSelection, {
        openai: { available: true },
        ollama: { available: true, models: ['qwen3'] },
      }),
    ).toEqual(ollamaSelection);
  });
});

it('preserves local intent when Ollama is offline even if OpenAI is available', () => {
  expect(
    reconcileProviderSelection(ollamaSelection, {
      openai: { available: true },
      ollama: { available: false, models: [], error: 'Offline' },
    }),
  ).toEqual(ollamaSelection);
});
