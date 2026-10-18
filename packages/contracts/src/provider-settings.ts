import { z } from 'zod';

const LoopbackUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}, 'Ollama must use a loopback HTTP URL');

export const ProviderSelectionSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('openai') }).strict(),
  z.object({
    provider: z.literal('ollama'),
    baseUrl: LoopbackUrlSchema,
    model: z.string().min(1).max(200),
  }).strict(),
  z.object({
    provider: z.literal('chatgpt'),
    accountId: z.string().min(1).max(80),
    model: z.string().min(1).max(200),
  }).strict(),
]);

export const ProviderCapabilitiesSchema = z.object({
  browserTools: z.boolean(),
  realtimeVoice: z.boolean(),
  dictation: z.boolean(),
}).strict();

export type ProviderSelection = z.infer<typeof ProviderSelectionSchema>;
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;
