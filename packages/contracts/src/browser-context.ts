import { z } from 'zod';

const HttpUrlSchema = z.string().max(2_000).refine((value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'Only HTTP(S) URLs are allowed');

export const TabReferenceSchema = z.object({
  tabId: z.number().int().nonnegative(),
  windowId: z.number().int(),
  active: z.boolean(),
  url: HttpUrlSchema,
  title: z.string().max(500),
  domain: z.string().max(253),
  favIconUrl: z.string().max(2_000).optional(),
  discarded: z.boolean(),
  lastSeenAt: z.iso.datetime(),
}).strict();

export const SourceReferenceSchema = TabReferenceSchema;

export const BrowserContextSchema = z.object({
  tabs: z.array(TabReferenceSchema).max(100),
  originTab: TabReferenceSchema.optional(),
  currentTabId: z.number().int().nonnegative(),
}).strict();

export type TabReference = z.infer<typeof TabReferenceSchema>;
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export type BrowserContext = z.infer<typeof BrowserContextSchema>;
