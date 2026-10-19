import { z } from 'zod';

import { PageSnapshotSchema } from './page';
import { AgentDecisionSchema, TaskStateSchema } from './task';
import { BrowserContextSchema } from './browser-context';

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Persisted with a chat turn: metadata and a small thumbnail only, never the full image. */
export const TurnImageSchema = z
  .object({
    name: z.string().min(1).max(250),
    mime: z.enum(IMAGE_MIME_TYPES),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
    thumbnail: z.string().startsWith('data:image/').max(80_000),
  })
  .strict();

/** Sent with one chat request only (full resolution, already downscaled client-side). */
export const ChatImageInputSchema = z
  .object({
    name: z.string().min(1).max(250),
    mime: z.enum(IMAGE_MIME_TYPES),
    dataUrl: z
      .string()
      .max(6_000_000)
      .regex(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/),
  })
  .strict();
export const MAX_CHAT_IMAGES = 4;

export const ConversationTurnSchema = z
  .object({
    id: z.string().min(1).max(120),
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(4_000),
    createdAt: z.iso.datetime(),
    images: z.array(TurnImageSchema).max(MAX_CHAT_IMAGES).optional(),
  })
  .strict();
export type TurnImage = z.infer<typeof TurnImageSchema>;
export type ChatImageInput = z.infer<typeof ChatImageInputSchema>;

export const AgentStepRequestSchema = z
  .object({
    requestId: z.string().min(1).max(120),
    taskId: z.string().min(1).max(120),
    cancellationGeneration: z.number().int().nonnegative(),
    utterance: z.string().min(1).max(4_000),
    conversation: z.array(ConversationTurnSchema).max(30),
    page: PageSnapshotSchema,
    task: TaskStateSchema.nullable(),
    browserContext: BrowserContextSchema.optional(),
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
