import { z } from 'zod';

import { SourceReferenceSchema } from './browser-context';
import { ConversationTurnSchema } from './provider';

export const TimelineStepSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(500),
  status: z.enum(['pending', 'active', 'completed', 'error']),
  detail: z.string().max(2_000).optional(),
  sources: z.array(SourceReferenceSchema).max(10).optional(),
}).strict();

export const PersistedTurnSchema = ConversationTurnSchema.extend({
  provider: z.enum(['openai', 'ollama']).optional(),
  model: z.string().min(1).max(200).optional(),
  sources: z.array(SourceReferenceSchema).max(10).default([]),
}).strict();

export const PersistedConversationSchema = z.object({
  version: z.literal(1),
  turns: z.array(PersistedTurnSchema).max(200),
  timeline: z.array(TimelineStepSchema).max(100),
}).strict();

export type TimelineStep = z.infer<typeof TimelineStepSchema>;
export type PersistedTurn = z.infer<typeof PersistedTurnSchema>;
export type PersistedConversation = z.infer<typeof PersistedConversationSchema>;
