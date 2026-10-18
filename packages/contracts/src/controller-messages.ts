import { z } from 'zod';
import { ProviderSelectionSchema } from './provider-settings';

import {
  AuthorizationRecordSchema,
  FinalReportSchema,
  OperationPreviewSchema,
  PlanItemSchema,
  TaskStatusSchema,
} from './agent';
import { TimelineStepSchema } from './history';
import { ElementIdSchema, PageSnapshotSchema } from './page';
import { DomToolCallSchema, RepeatActionSchema } from './tools';
import { TabReferenceSchema } from './browser-context';

const TabChoiceSchema = TabReferenceSchema.extend({
  number: z.number().int().positive().max(999),
}).strict();

export const ScheduledTaskSchema = z
  .object({
    id: z.string().min(1).max(120),
    instruction: z.string().min(1).max(4000),
    runAt: z.number().int().nonnegative(),
    originTabId: z.number().int().nonnegative(),
    originUrl: z
      .string()
      .url()
      .max(4000)
      .refine((url) => /^https?:\/\//i.test(url)),
    provider: z.enum(['openai', 'ollama']),
    providerSelection: ProviderSelectionSchema.optional(),
    status: z.enum(['pending', 'running', 'attention', 'completed', 'failed', 'cancelled']),
    detail: z.string().max(1000).optional(),
  })
  .strict();
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const ControllerSnapshotSchema = z
  .object({
    taskId: z.string().min(1).max(120).optional(),
    status: z.union([TaskStatusSchema, z.literal('idle')]),
    startedAt: z.number().int().nonnegative().optional(),
    completedAt: z.number().int().nonnegative().optional(),
    goal: z.string().max(4_000).optional(),
    plan: z.array(PlanItemSchema).max(40),
    memorySummary: z
      .object({
        recordCount: z.number().int().nonnegative(),
        issues: z.array(z.string().max(1_000)).max(30),
      })
      .strict(),
    pendingPreview: OperationPreviewSchema.optional(),
    pendingQuestion: z.string().max(1_000).optional(),
    tabChoices: z.array(TabChoiceSchema).max(100).optional(),
    sources: z.array(TabReferenceSchema).max(100).optional(),
    report: FinalReportSchema.optional(),
    capability: z.enum(['dom_only', 'dom_plus_trusted_input']),
    authorization: AuthorizationRecordSchema.optional(),
    timeline: z.array(TimelineStepSchema).max(100),
    statusText: z.string().max(500).optional(),
    fallbackOffer: z
      .object({ reason: z.string().min(1).max(1_000) })
      .strict()
      .optional(),
    records: z.number().int().nonnegative().optional(),
  })
  .strict();

export const PanelMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manage_schedule'), id: z.string().min(1).max(120), action: z.enum(['run','delete','update']), instruction: z.string().trim().min(1).max(4000).optional(), runAt: z.number().int().nonnegative().optional() }).strict(),
  z.object({ type: z.literal('cancel_schedule'), id: z.string().min(1).max(120) }).strict(),
  z
    .object({
      type: z.literal('instruct'),
      text: z.string().min(1).max(4_000),
      source: z.enum(['text', 'voice']),
      originTabId: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('control'),
      action: z.enum(['stop', 'pause', 'resume', 'continue_budget']),
    })
    .strict(),
  z
    .object({
      type: z.literal('confirm'),
      previewId: z.string().min(1).max(120),
      approved: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('answer'), text: z.string().min(1).max(4_000) }).strict(),
  z
    .object({ type: z.literal('capability_granted'), capability: z.literal('trusted_input') })
    .strict(),
  z.object({ type: z.literal('request_export'), format: z.enum(['csv', 'xlsx']) }).strict(),
  z.object({ type: z.literal('hello') }).strict(),
  z.object({ type: z.literal('approve_fallback'), approved: z.boolean() }).strict(),
]);

export const ControllerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('schedules'), jobs: z.array(ScheduledTaskSchema).max(50) }).strict(),
  z.object({ type: z.literal('state'), task: ControllerSnapshotSchema }).strict(),
  z.object({ type: z.literal('milestone'), text: z.string().min(1).max(1_000) }).strict(),
  z
    .object({
      type: z.literal('export_ready'),
      format: z.enum(['csv', 'xlsx']),
      filename: z.string().min(1).max(200),
      dataBase64: z.string().max(20_000_000),
      mime: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal('need_capability'),
      capability: z.literal('trusted_input'),
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
]);

export const ContentRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observe') }).strict(),
  z
    .object({
      type: z.literal('execute'),
      call: DomToolCallSchema,
      documentId: z.string().min(1).max(120),
      generation: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal('cursor'), x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ type: z.literal('cursor_hide') }).strict(),
  z
    .object({
      type: z.literal('timed_start'),
      repeatId: z.string().min(1).max(120),
      action: RepeatActionSchema,
      intervalMs: z.number().int().min(1_000).max(60_000),
      maxDurationMs: z.number().int().min(1_000).max(1_800_000),
      stopAtEnd: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('timed_stop'), repeatId: z.string().min(1).max(120) }).strict(),
  z
    .object({
      type: z.literal('otp_extract'),
      service: z.string().min(1).max(120),
      now: z.number().int(),
    })
    .strict(),
  z
    .object({
      type: z.literal('otp_enter'),
      elementId: ElementIdSchema,
      documentId: z.string().min(1).max(120),
      envelopeCode: z.string().regex(/^\d{4,8}$/),
    })
    .strict(),
  z.object({ type: z.literal('read_text'), elementId: ElementIdSchema.optional() }).strict(),
  z.object({ type: z.literal('inspect'), elementId: ElementIdSchema }).strict(),
]);

export const ContentResultSchema = z
  .object({
    ok: z.boolean(),
    detail: z.string().max(2_000),
    changed: z.boolean(),
    documentId: z.string().min(1).max(120),
    snapshot: PageSnapshotSchema.optional(),
    text: z.string().max(20_000).optional(),
    element: z
      .object({
        kind: z.string().max(40),
        role: z.string().max(80).optional(),
        name: z.string().max(500).optional(),
        inputType: z.string().max(80).optional(),
        autocomplete: z.string().max(80).optional(),
        codeLike: z.boolean().optional(),
        formHasSensitiveField: z.boolean().optional(),
        rect: z
          .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    point: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    otp: z
      .object({
        status: z.enum(['found', 'ambiguous', 'none', 'stale']),
        envelopeCode: z
          .string()
          .regex(/^\d{4,8}$/)
          .optional(),
        acceptedLength: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    ended: z.enum(['stopped', 'end_reached', 'max_duration', 'navigated']).optional(),
  })
  .strict();

export type ControllerSnapshot = z.infer<typeof ControllerSnapshotSchema>;
export type PanelMessage = z.infer<typeof PanelMessageSchema>;
export type ControllerMessage = z.infer<typeof ControllerMessageSchema>;
export type ContentRequest = z.infer<typeof ContentRequestSchema>;
export type ContentResult = z.infer<typeof ContentResultSchema>;

export const ContentEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('content.timed_ended'),
      repeatId: z.string().min(1).max(120),
      reason: z.enum(['stopped', 'end_reached', 'max_duration', 'navigated']),
    })
    .strict(),
]);

export type ContentEvent = z.infer<typeof ContentEventSchema>;
