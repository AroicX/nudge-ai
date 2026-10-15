import { z } from 'zod';

import { BrowserActionSchema } from './action';

const EnvelopeSchema = {
  requestId: z.string().min(1).max(120),
  taskId: z.string().min(1).max(120),
};

export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page.observe'), ...EnvelopeSchema }).strict(),
  z
    .object({
      type: z.literal('page.execute'),
      ...EnvelopeSchema,
      tabId: z.number().int().nonnegative(),
      documentId: z.string().min(1).max(120),
      cancellationGeneration: z.number().int().nonnegative(),
      action: BrowserActionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('task.stop'),
      ...EnvelopeSchema,
      generation: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal('sidepanel.open'), requestId: z.string().min(1).max(120) }).strict(),
]);

export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;
