import { z } from 'zod';

import { PageSnapshotSchema } from './page';
import { AgentDecisionSchema, TaskStateSchema } from './task';

export const ConversationTurnSchema = z
  .object({
    id: z.string().min(1).max(120),
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(4_000),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const AgentStepRequestSchema = z
  .object({
    requestId: z.string().min(1).max(120),
    taskId: z.string().min(1).max(120),
    cancellationGeneration: z.number().int().nonnegative(),
    utterance: z.string().min(1).max(4_000),
    conversation: z.array(ConversationTurnSchema).max(30),
    page: PageSnapshotSchema,
    task: TaskStateSchema.nullable(),
  })
  .strict();

export const AgentStepResponseSchema = z
  .object({
    requestId: z.string().min(1).max(120),
    task: TaskStateSchema,
    decision: AgentDecisionSchema,
  })
  .strict();

export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
export type AgentStepRequest = z.infer<typeof AgentStepRequestSchema>;
export type AgentStepResponse = z.infer<typeof AgentStepResponseSchema>;
