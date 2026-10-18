import OpenAI from 'openai';
import type { ChatImageInput, ProviderSelection } from '@nudge/contracts';
import { OllamaDecisionProvider } from '../providers/ollama-provider';
import { MEMORY_REFERENCE_RULES } from './reference-context';

export interface MemoryChatInput {
  provider: 'ollama' | 'openai';
  question: string;
  context: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  images?: ChatImageInput[];
}
export type MemoryChatResponder = (input: MemoryChatInput, signal: AbortSignal) => Promise<string>;
export function createMemoryChatResponder(
  settings: (provider: 'ollama' | 'openai') => {
    selection: ProviderSelection;
    apiKey: string;
    openAIModel: string;
  },
  fetcher: typeof fetch = fetch,
  capabilities: (baseUrl: string, model: string) => Promise<{ vision: boolean }> = (baseUrl, model) =>
    OllamaDecisionProvider.capabilities(baseUrl, model, fetcher),
): MemoryChatResponder {
  return async (input, signal) => {
    const { selection, apiKey, openAIModel } = settings(input.provider);
    if (selection.provider !== input.provider)
      throw new Error('The selected provider is not ready. Select your model again.');
    const instructions = `You are Nudge, the user's personal browser companion. Answer conversational questions, review or draft text using the supplied local references. This channel cannot execute browser actions. Never claim that you opened, applied, submitted, sent, or scheduled anything. If the request requires browser action, explain what information is needed without inventing a result. ${MEMORY_REFERENCE_RULES} Say when a requested memory is absent. Keep replies concise but include the actual answer. Relevant saved reference data follows as JSON:\n${input.context}`;
    const images = input.images ?? [];
    if (selection.provider === 'ollama') {
      if (images.length) {
        // Only a model that reports the vision capability receives images; no provider switch.
        const vision = await capabilities(selection.baseUrl, selection.model)
          .then((value) => value.vision)
          .catch(() => false);
        if (!vision)
          throw new Error(
            `The local model “${selection.model}” cannot read images. Choose an Ollama model with vision in Provider settings, or remove the images.`,
          );
      }
      const response = await fetcher(`${selection.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: selection.model,
          think: false,
          stream: false,
          keep_alive: '2m',
          options: { num_ctx: 8192, num_predict: 700, temperature: 0 },
          messages: [
            { role: 'system', content: instructions },
            ...input.history,
            {
              role: 'user',
              content: input.question,
              ...(images.length ? { images: images.map((image) => image.dataUrl.replace(/^data:[^,]+,/, '')) } : {}),
            },
          ],
        }),
      });
      if (!response.ok)
        throw new Error('Local Ollama could not answer. Check that the selected model is running.');
      const body = (await response.json()) as { message?: { content?: string } };
      if (!body.message?.content?.trim()) throw new Error('Ollama returned an empty answer.');
      return body.message.content.trim();
    }
    if (!apiKey)
      throw new Error('OpenAI is not configured. Choose a local model or add your API key.');
    const response = await new OpenAI({ apiKey }).responses.create(
      {
        model: openAIModel,
        instructions,
        input: [
          ...input.history,
          images.length
            ? {
                role: 'user' as const,
                content: [
                  { type: 'input_text' as const, text: input.question },
                  ...images.map((image) => ({ type: 'input_image' as const, image_url: image.dataUrl, detail: 'auto' as const })),
                ],
              }
            : { role: 'user' as const, content: input.question },
        ],
        max_output_tokens: 1000,
      },
      { signal },
    );
    if (!response.output_text?.trim()) throw new Error('OpenAI returned an empty answer.');
    return response.output_text.trim();
  };
}
