import { z } from 'zod';

import { TabReferenceSchema } from './browser-context';
import { ObservationSchema } from './observation';
import { ElementIdSchema } from './page';
import { PreviewProposalSchema, ToolCallSchema } from './tools';

export const TaskStatusSchema = z.enum([
  'planning',
  'running',
  'waiting_for_page',
  'waiting_for_user',
  'waiting_for_confirmation',
  'paused',
  'completed',
  'partially_completed',
  'failed',
  'cancelled',
]);

export const TERMINAL_STATUSES = ['completed', 'partially_completed', 'failed', 'cancelled'] as const;

export const ActionCategorySchema = z.enum([
  'read',
  'navigate',
  'fill',
  'create_records',
  'edit',
  'move_reversible',
  'delete_permanent',
  'submit_form',
  'send_message',
  'purchase',
  'auth_challenge',
  'transfer_code',
]);

export const AuthorizationProposalSchema = z
  .object({
    origins: z.union([z.array(z.string().min(1).max(300)).max(50), z.literal('browse_web')]),
    categories: z.array(ActionCategorySchema).max(12),
    destinations: z.array(z.string().min(1).max(500)).max(20),
    exclusions: z.array(z.string().min(1).max(500)).max(20),
    limits: z.object({ maxItems: z.number().int().positive().max(10_000).optional() }).strict(),
  })
  .strict();

export const AuthorizationRecordSchema = AuthorizationProposalSchema.extend({
  taskId: z.string().min(1).max(120),
  instruction: z.string().min(1).max(4_000),
}).strict();

export const OperationPreviewSchema = PreviewProposalSchema.extend({
  previewId: z.string().min(1).max(120),
  targetFingerprint: z.string().min(1).max(200),
}).strict();

export const PlanItemSchema = z
  .object({
    id: z.string().min(1).max(60),
    text: z.string().min(1).max(500),
    status: z.enum(['pending', 'active', 'done', 'skipped']),
  })
  .strict();

export const ExtractedRecordSchema = z
  .object({
    id: z.string().min(1).max(120),
    key: z.string().min(1).max(2_000),
    fields: z.record(z.string().max(80), z.string().max(2_000)),
    sourceUrl: z.string().min(1).max(2_000),
    observedAt: z.string().min(1).max(40),
    saved: z
      .object({
        destination: z
          .object({
            tabId: z.number().int().nonnegative(),
            rowHint: z.string().max(200),
            verifiedAt: z.string().max(40),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export const TabRoleSchema = z.enum(['origin', 'source', 'destination', 'opened_by_nudge', 'other']);

export const MemoryStepSchema = z
  .object({
    tool: z.string().min(1).max(60),
    summary: z.string().min(1).max(1_000),
    ok: z.boolean(),
    evidence: z.string().max(1_000).optional(),
    uncertain: z.boolean().optional(),
  })
  .strict();

export const TaskMemorySchema = z
  .object({
    goal: z.string().min(1).max(4_000),
    constraints: z
      .array(z.object({ text: z.string().min(1).max(2_000), instructionVersion: z.number().int().nonnegative() }).strict())
      .max(50),
    userData: z
      .array(
        z
          .object({
            label: z.string().min(1).max(120),
            value: z.string().max(2_000),
            sensitive: z.boolean().optional(),
          })
          .strict(),
      )
      .max(50),
    plan: z.array(PlanItemSchema).max(40),
    steps: z.array(MemoryStepSchema).max(60),
    tabs: z
      .array(
        z
          .object({
            tabId: z.number().int().nonnegative(),
            role: TabRoleSchema,
            title: z.string().max(500),
            origin: z.string().max(300),
          })
          .strict(),
      )
      .max(50),
    recordFields: z.array(z.string().min(1).max(80)).max(30),
    recordCount: z.number().int().nonnegative(),
    sources: z.array(z.string().max(2_000)).max(100),
    issues: z.array(z.string().min(1).max(1_000)).max(30),
  })
  .strict();

export const FinalReportSchema = z
  .object({
    outcome: z.enum(['completed', 'partially_completed', 'failed', 'cancelled']),
    summary: z.string().min(1).max(4_000),
    verified: z.array(z.string().max(1_000)).max(100),
    partial: z.array(z.string().max(1_000)).max(100),
    unverified: z.array(z.string().max(1_000)).max(100),
    skipped: z.array(z.object({ item: z.string().max(1_000), reason: z.string().max(1_000) }).strict()).max(100),
    sources: z.array(z.string().max(2_000)).max(100),
    exports: z.array(z.string().max(200)).max(20),
  })
  .strict();

export const ExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text_present'), text: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('text_absent'), text: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('url_changed') }).strict(),
  z.object({ kind: z.literal('value_equals'), elementId: ElementIdSchema, value: z.string().max(2_000) }).strict(),
  z.object({ kind: z.literal('count_changed') }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
]);

export const CapabilitiesSchema = z
  .object({ vision: z.boolean(), trustedInput: z.boolean() })
  .strict();

export const PlannerRequestSchema = z
  .object({
    requestId: z.string().min(1).max(120),
    taskId: z.string().min(1).max(120),
    generation: z.number().int().nonnegative(),
    instructionVersion: z.number().int().nonnegative(),
    goal: z.string().min(1).max(4_000),
    memory: TaskMemorySchema,
    authorization: AuthorizationRecordSchema,
    observation: ObservationSchema.nullable(),
    tabs: z.array(TabReferenceSchema).max(100),
    lastResult: z
      .object({ tool: z.string().max(60), ok: z.boolean(), detail: z.string().max(2_000) })
      .strict()
      .optional(),
    capabilities: CapabilitiesSchema,
    notes: z.array(z.string().min(1).max(1_000)).max(20),
    referenceContext: z.string().max(4000).optional(),
    currentTime: z.string().max(150).optional(),
  })
  .strict();

export const PlannerResponseSchema = z
  .object({
    requestId: z.string().min(1).max(120),
    planUpdate: z.array(PlanItemSchema).max(40).optional(),
    riskLabel: z.enum(['none', 'consequential']).optional(),
    expectation: ExpectationSchema.optional(),
    toolCall: ToolCallSchema,
  })
  .strict();

export const ScopeRequestSchema = z
  .object({
    originTabId: z.number().int().nonnegative().optional(),
    requestId: z.string().min(1).max(120),
    instruction: z.string().min(1).max(4_000),
    tabs: z
      .array(z.object({ tabId: z.number().int().nonnegative(), title: z.string().max(500), url: z.string().max(2_000) }).strict())
      .max(100),
  })
  .strict();

export const ScopeResponseSchema = z
  .object({
    requestId: z.string().min(1).max(120),
    goal: z.string().min(1).max(4_000),
    proposal: AuthorizationProposalSchema,
    recordFields: z.array(z.string().min(1).max(80)).max(30).optional(),
  })
  .strict();

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ActionCategory = z.infer<typeof ActionCategorySchema>;
export type AuthorizationProposal = z.infer<typeof AuthorizationProposalSchema>;
export type AuthorizationRecord = z.infer<typeof AuthorizationRecordSchema>;
export type OperationPreview = z.infer<typeof OperationPreviewSchema>;
export type PlanItem = z.infer<typeof PlanItemSchema>;
export type ExtractedRecord = z.infer<typeof ExtractedRecordSchema>;
export type TabRole = z.infer<typeof TabRoleSchema>;
export type MemoryStep = z.infer<typeof MemoryStepSchema>;
export type TaskMemory = z.infer<typeof TaskMemorySchema>;
export type FinalReport = z.infer<typeof FinalReportSchema>;
export type Expectation = z.infer<typeof ExpectationSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export type PlannerRequest = z.infer<typeof PlannerRequestSchema>;
export type PlannerResponse = z.infer<typeof PlannerResponseSchema>;
export type ScopeRequest = z.infer<typeof ScopeRequestSchema>;
export type ScopeResponse = z.infer<typeof ScopeResponseSchema>;
