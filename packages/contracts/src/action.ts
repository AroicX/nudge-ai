import { z } from 'zod';

import { ElementIdSchema, PageSnapshotSchema } from './page';

const HttpUrlSchema = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));

const ReadPageActionSchema = z.object({ type: z.literal('read_page') }).strict();
const ClickActionSchema = z
  .object({ type: z.literal('click'), elementId: ElementIdSchema })
  .strict();
const TypeTextActionSchema = z
  .object({
    type: z.literal('type_text'),
    elementId: ElementIdSchema,
    text: z.string().max(10_000),
    mode: z.enum(['replace', 'append']),
  })
  .strict();
const SelectOptionActionSchema = z
  .object({
    type: z.literal('select_option'),
    elementId: ElementIdSchema,
    value: z.string().min(1).max(1_000),
  })
  .strict();
const ScrollActionSchema = z
  .object({
    type: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.union([z.literal('viewport'), z.number().positive().max(5_000)]),
  })
  .strict();
const NavigateActionSchema = z
  .object({
    type: z.literal('navigate_to_observed_url'),
    url: HttpUrlSchema,
    sourceElementId: ElementIdSchema,
  })
  .strict();
const WaitActionSchema = z
  .object({
    type: z.literal('wait_for_change'),
    timeoutMs: z.number().int().min(100).max(10_000),
  })
  .strict();

export const BrowserActionSchema = z.discriminatedUnion('type', [
  ReadPageActionSchema,
  ClickActionSchema,
  TypeTextActionSchema,
  SelectOptionActionSchema,
  ScrollActionSchema,
  NavigateActionSchema,
  WaitActionSchema,
]);

export const ActionResultSchema = z
  .object({
    ok: z.boolean(),
    actionType: z.enum([
      'read_page',
      'click',
      'type_text',
      'select_option',
      'scroll',
      'navigate_to_observed_url',
      'wait_for_change',
    ]),
    documentId: z.string().min(1),
    changed: z.boolean(),
    detail: z.string().max(2_000),
    page: PageSnapshotSchema.optional(),
  })
  .strict();

export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
