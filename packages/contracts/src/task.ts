import { z } from 'zod';

import { BrowserActionSchema } from './action';
import { ElementIdSchema } from './page';

export const IntentCategorySchema = z.enum([
  'search',
  'navigate',
  'filter',
  'inspect',
  'fill_form',
  'prepare_action',
  'unsupported',
]);

export const RiskCategorySchema = z.enum(['low', 'confirmation_required', 'blocked']);

export const TaskConstraintSchema = z
  .object({
    key: z.string().min(1).max(120),
    value: z.string().min(1).max(2_000),
    source: z.enum(['explicit', 'resolved_reference']),
  })
  .strict();

export const VerifiedActionSchema = z
  .object({
    action: BrowserActionSchema,
    verifiedAt: z.iso.datetime(),
    evidence: z.string().min(1).max(2_000),
    snapshotId: z.string().min(1).max(120),
  })
  .strict();

export const TaskStateSchema = z
  .object({
    id: z.string().min(1).max(120),
    goal: z.string().min(1).max(4_000),
    intent: IntentCategorySchema,
    constraints: z.array(TaskConstraintSchema).max(50),
    successConditions: z.array(z.string().min(1).max(1_000)).min(1).max(20),
    missingRequiredInformation: z.array(z.string().min(1).max(200)).max(20),
    risk: RiskCategorySchema,
    status: z.enum([
      'active',
      'waiting_for_user',
      'waiting_for_confirmation',
      'completed',
      'stopped',
      'failed',
    ]),
    cancellationGeneration: z.number().int().nonnegative(),
    verifiedActions: z.array(VerifiedActionSchema).max(100),
    boundTabId: z.number().int().nonnegative(),
    boundDocumentId: z.string().min(1).max(120),
  })
  .strict();

export const TaskEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.started'), task: TaskStateSchema }).strict(),
  z
    .object({
      type: z.literal('task.modified'),
      constraints: z.array(TaskConstraintSchema).max(50),
    })
    .strict(),
  z.object({ type: z.literal('task.waiting'), reason: z.string().min(1).max(1_000) }).strict(),
  z
    .object({ type: z.literal('task.action_verified'), verifiedAction: VerifiedActionSchema })
    .strict(),
  z
    .object({ type: z.literal('task.stopped'), generation: z.number().int().nonnegative() })
    .strict(),
  z
    .object({
      type: z.literal('task.completed'),
      evidence: z.array(z.string().min(1)).min(1).max(20),
    })
    .strict(),
]);

const EvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('element_state'),
      elementId: ElementIdSchema,
      detail: z.string().min(1).max(2_000),
    })
    .strict(),
  z.object({ kind: z.literal('url'), url: z.url(), detail: z.string().min(1).max(2_000) }).strict(),
  z.object({ kind: z.literal('page_text'), text: z.string().min(1).max(2_000) }).strict(),
]);

export const SwitchTabDecisionSchema = z.object({
  type: z.literal('switch_tab'),
  taskId: z.string().min(1).max(120),
  tabId: z.number().int().nonnegative(),
  reason: z.string().min(1).max(500),
}).strict();

export const AgentDecisionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('act'),
      taskId: z.string().min(1).max(120),
      action: BrowserActionSchema,
      expectedOutcome: z.string().min(1).max(2_000),
      narration: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('ask_user'),
      taskId: z.string().min(1).max(120),
      question: z.string().min(1).max(1_000),
      missing: z.array(z.string().min(1).max(200)).min(1).max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal('finish'),
      taskId: z.string().min(1).max(120),
      message: z.string().min(1).max(2_000),
      evidence: z.array(EvidenceSchema).min(1).max(20),
    })
    .strict(),
  SwitchTabDecisionSchema,
]);

export type IntentCategory = z.infer<typeof IntentCategorySchema>;
export type RiskCategory = z.infer<typeof RiskCategorySchema>;
export type TaskConstraint = z.infer<typeof TaskConstraintSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type SwitchTabDecision = z.infer<typeof SwitchTabDecisionSchema>;
