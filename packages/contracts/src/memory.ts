import { z } from 'zod';
import { PersistedTurnSchema } from './history';

export const MemoryIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w:.-]+$/);
export const MemoryChatSchema = z
  .object({
    id: MemoryIdSchema,
    title: z.string().min(1).max(200),
    createdAt: z.string(),
    updatedAt: z.string(),
    generation: z.number().int().nonnegative(),
  })
  .strict();
export const MemoryFactSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z.string().min(1).max(2000),
    source: z.string().max(500),
    updatedAt: z.string(),
  })
  .strict();
export const MemoryDocumentSchema = z
  .object({
    id: MemoryIdSchema,
    filename: z.string().min(1).max(250),
    text: z.string().max(500_000),
    source: z.string().max(500),
    createdAt: z.string(),
  })
  .strict();
export const MemorySearchResultSchema = z
  .object({
    kind: z.enum(['message', 'document', 'fact']),
    id: z.string(),
    chatId: z.string().optional(),
    title: z.string(),
    text: z.string(),
    source: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export const MemoryMessagesSchema = z
  .object({
    messages: z.array(PersistedTurnSchema).max(500),
    generation: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryChat = z.infer<typeof MemoryChatSchema>;
export type MemoryFact = z.infer<typeof MemoryFactSchema>;
export type MemoryDocument = z.infer<typeof MemoryDocumentSchema>;
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;
