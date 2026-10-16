import { z } from 'zod';

import { SourceReferenceSchema } from './browser-context';

export const VoiceSessionStateSchema = z.enum([
  'idle',
  'connecting',
  'listening',
  'user-speaking',
  'assistant-speaking',
  'interrupted',
  'reconnecting',
  'failed',
  'ended',
]);

export const VoiceSessionConfigSchema = z
  .object({
    clientSecret: z.string().min(1).max(2_000),
    model: z.string().min(1).max(120),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export const VoiceToolResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string().min(1).max(2_000),
    sources: z.array(SourceReferenceSchema).max(10).optional(),
  })
  .strict();

export const VoiceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: VoiceSessionStateSchema }).strict(),
  z
    .object({
      type: z.literal('transcript'),
      role: z.enum(['user', 'assistant']),
      text: z.string().max(10_000),
      final: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('speech.started'), role: z.enum(['user', 'assistant']) }).strict(),
  z.object({ type: z.literal('speech.stopped'), role: z.enum(['user', 'assistant']) }).strict(),
  z
    .object({
      type: z.literal('function.intent'),
      name: z.string().min(1).max(120),
      arguments: z.record(z.string(), z.unknown()),
      callId: z.string().min(1).max(200),
    })
    .strict(),
  z.object({ type: z.literal('error'), message: z.string().min(1).max(1_000) }).strict(),
]);

export type VoiceSessionState = z.infer<typeof VoiceSessionStateSchema>;
export type VoiceSessionConfig = z.infer<typeof VoiceSessionConfigSchema>;
export type VoiceToolResult = z.infer<typeof VoiceToolResultSchema>;
export type VoiceEvent = z.infer<typeof VoiceEventSchema>;
