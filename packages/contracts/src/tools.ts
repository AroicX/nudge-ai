import { z } from 'zod';

import { ElementIdSchema } from './page';

export const HttpUrlStringSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Only HTTP(S) URLs are allowed');

export const NAMED_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Space',
  'F2',
] as const;
export const MODIFIERS = ['Control', 'Meta', 'Shift', 'Alt'] as const;

// Browser-level shortcuts that would close/open windows or tabs, quit, or open DevTools.
const BLOCKED_CHORDS = [/^(Control|Meta)\+(W|T|N|Q)$/i, /^(Control|Meta)\+Shift\+(I|J|C|N|T|W|Q|Delete)$/i, /^F12$/i, /^(Control|Meta)\+(Alt|Option)\+(I|J)$/i];

export function parseKeyChord(chord: string): { modifiers: string[]; key: string } | undefined {
  const parts = chord.split('+');
  const key = parts.pop();
  if (!key) return undefined;
  const modifiers = parts;
  if (new Set(modifiers).size !== modifiers.length) return undefined;
  if (!modifiers.every((m) => (MODIFIERS as readonly string[]).includes(m))) return undefined;
  const isNamed = (NAMED_KEYS as readonly string[]).includes(key);
  const isChar = key.length === 1 && key !== '+';
  if (!isNamed && !isChar) return undefined;
  return { modifiers, key };
}

export const KeyChordSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((chord) => parseKeyChord(chord) !== undefined, 'Unsupported key or chord')
  .refine((chord) => !BLOCKED_CHORDS.some((pattern) => pattern.test(chord)), 'Blocked browser shortcut');

const TabId = z.number().int().nonnegative();
const Coord = z.number().finite().nonnegative().max(100_000);
const Point = z.object({ x: Coord, y: Coord }).strict();

const tab = { tabId: TabId };
const element = { tabId: TabId, elementId: ElementIdSchema };
const visual = { tabId: TabId, screenshotId: z.string().min(1).max(120) };

export const WaitConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text_present'), text: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('text_absent'), text: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('url_matches'), prefix: z.string().min(1).max(2_000) }).strict(),
  z
    .object({
      kind: z.literal('element_count'),
      text: z.string().min(1).max(200),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('idle') }).strict(),
]);

export const ScrollAmountSchema = z.union([z.literal('viewport'), z.literal('end'), z.number().positive().max(20_000)]);
export const ScrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);

export const RepeatActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scroll'), direction: ScrollDirectionSchema, amount: ScrollAmountSchema }).strict(),
  z.object({ kind: z.literal('press_keys'), keys: z.array(KeyChordSchema).min(1).max(5) }).strict(),
]);

export const PreviewProposalSchema = z
  .object({
    operation: z.string().min(1).max(200),
    location: z.string().min(1).max(500),
    criteria: z.string().min(1).max(1_000),
    count: z.number().int().nonnegative().max(100_000),
    samples: z.array(z.string().min(1).max(300)).max(5),
    reversible: z.boolean(),
    permanent: z.boolean(),
  })
  .strict();

export const RecordFieldSchema = z
  .object({ name: z.string().min(1).max(80), value: z.string().max(2_000) })
  .strict();

export const RecordInputSchema = z
  .object({
    // Array form keeps the schema compatible with strict function calling.
    fields: z.union([z.array(RecordFieldSchema).max(30), z.record(z.string().max(80), z.string().max(2_000))]),
    sourceUrl: HttpUrlStringSchema,
  })
  .strict();

export const DomToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('read_text'), tabId: TabId, elementId: ElementIdSchema.optional() }).strict(),
  z.object({ tool: z.literal('inspect_element'), ...element }).strict(),
  z.object({ tool: z.literal('click'), ...element }).strict(),
  z.object({ tool: z.literal('double_click'), ...element }).strict(),
  z.object({ tool: z.literal('hover'), ...element }).strict(),
  z.object({ tool: z.literal('focus'), ...element }).strict(),
  z
    .object({
      tool: z.literal('type_text'),
      ...element,
      text: z.string().max(10_000),
      mode: z.enum(['replace', 'append']),
    })
    .strict(),
  z
    .object({
      tool: z.literal('press_keys'),
      tabId: TabId,
      keys: z.array(KeyChordSchema).min(1).max(20),
      elementId: ElementIdSchema.optional(),
    })
    .strict(),
  z.object({ tool: z.literal('select_option'), ...element, value: z.string().min(1).max(1_000) }).strict(),
  z
    .object({
      tool: z.literal('choose_option'),
      ...element,
      /** Visible option text to pick (custom dropdown, combobox, autocomplete, listbox). */
      value: z.string().min(1).max(500),
      /** Text to type first when the control filters options as you type (autocomplete). */
      query: z.string().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal('scroll'),
      tabId: TabId,
      direction: ScrollDirectionSchema,
      amount: ScrollAmountSchema,
      elementId: ElementIdSchema.optional(),
    })
    .strict(),
  z
    .object({ tool: z.literal('drag'), tabId: TabId, fromElementId: ElementIdSchema, toElementId: ElementIdSchema })
    .strict(),
  z
    .object({
      tool: z.literal('wait_for'),
      tabId: TabId,
      condition: WaitConditionSchema,
      timeoutMs: z.number().int().min(100).max(15_000),
    })
    .strict(),
]);

export const ToolCallSchema = z.discriminatedUnion('tool', [
  // Observe
  z.object({ tool: z.literal('list_tabs') }).strict(),
  z.object({ tool: z.literal('observe_tab'), tabId: TabId, screenshot: z.boolean().optional() }).strict(),
  ...DomToolCallSchema.options,
  // Navigate
  z.object({ tool: z.literal('open_tab'), url: HttpUrlStringSchema }).strict(),
  z.object({ tool: z.literal('activate_tab'), ...tab }).strict(),
  z.object({ tool: z.literal('navigate'), ...tab, url: HttpUrlStringSchema }).strict(),
  z.object({ tool: z.literal('go_back'), ...tab }).strict(),
  z.object({ tool: z.literal('go_forward'), ...tab }).strict(),
  z.object({ tool: z.literal('reload'), ...tab }).strict(),
  z.object({ tool: z.literal('close_tab'), ...tab }).strict(),
  // Visual
  z.object({ tool: z.literal('click_at'), ...visual, x: Coord, y: Coord }).strict(),
  z.object({ tool: z.literal('double_click_at'), ...visual, x: Coord, y: Coord }).strict(),
  z.object({ tool: z.literal('drag_at'), ...visual, from: Point, to: Point }).strict(),
  z
    .object({ tool: z.literal('type_at'), ...visual, x: Coord, y: Coord, text: z.string().min(1).max(5_000) })
    .strict(),
  // Candidate profile (saved account documents and profile facts; read-only)
  z.object({ tool: z.literal('get_candidate_profile') }).strict(),
  z.object({ tool: z.literal('search_cv'), query: z.string().min(1).max(300) }).strict(),
  z.object({ tool: z.literal('list_documents') }).strict(),
  z
    .object({
      tool: z.literal('attach_document'),
      ...element,
      /** Omit to use the selected/default CV. */
      documentId: z.string().min(1).max(160).optional(),
    })
    .strict(),
  // Calendar (browser UI; no Calendar API)
  z
    .object({
      tool: z.literal('calendar_open_event_editor'),
      tabId: TabId,
      title: z.string().min(1).max(300),
      /** YYYY-MM-DD, or the user's relative words such as "tomorrow" or "next Monday". */
      date: z.string().min(1).max(60),
      /** As the user said it, e.g. "9am", "14:30". */
      startTime: z.string().min(1).max(40),
      endTime: z.string().min(1).max(40).optional(),
      durationMinutes: z.number().int().min(5).max(1_440).optional(),
      attendees: z.array(z.string().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)).max(50).optional(),
      location: z.string().min(1).max(500).optional(),
      details: z.string().min(1).max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal('calendar_find_event'),
      tabId: TabId,
      title: z.string().min(1).max(300),
      date: z.string().min(1).max(60),
    })
    .strict(),
  // Task control
  z
    .object({
      tool: z.literal('ask_user'),
      question: z.string().min(1).max(1_000),
      missing: z.array(z.string().min(1).max(200)).min(1).max(20),
    })
    .strict(),
  z.object({ tool: z.literal('request_confirmation'), preview: PreviewProposalSchema }).strict(),
  z
    .object({
      tool: z.literal('record_items'),
      records: z.array(RecordInputSchema).min(1).max(50),
    })
    .strict(),
  z.object({ tool: z.literal('export_records'), format: z.enum(['csv', 'xlsx']) }).strict(),
  z
    .object({
      tool: z.literal('start_timed_repeat'),
      tabId: TabId,
      action: RepeatActionSchema,
      intervalMs: z.number().int().min(1_000).max(60_000),
      maxDurationMs: z.number().int().min(1_000).max(1_800_000),
      stopAtEnd: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal('transfer_code'),
      sourceTabId: TabId,
      service: z.string().min(1).max(120),
      destinationTabId: TabId,
      destinationElementId: ElementIdSchema,
    })
    .strict(),
  z
    .object({
      tool: z.literal('finish'),
      summary: z.string().min(1).max(4_000),
      evidence: z.array(z.string().min(1).max(1_000)).max(20),
    })
    .strict(),
  z
    .object({
      tool: z.literal('report_partial'),
      done: z.array(z.string().min(1).max(500)).max(50),
      remaining: z.array(z.string().min(1).max(500)).max(50),
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
]);

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type DomToolCall = z.infer<typeof DomToolCallSchema>;
export type ToolName = ToolCall['tool'];
export type WaitCondition = z.infer<typeof WaitConditionSchema>;
export type RepeatAction = z.infer<typeof RepeatActionSchema>;
export type PreviewProposal = z.infer<typeof PreviewProposalSchema>;
export type RecordInput = z.infer<typeof RecordInputSchema>;

export const MUTATING_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'open_tab',
  'activate_tab',
  'navigate',
  'go_back',
  'go_forward',
  'reload',
  'close_tab',
  'click',
  'double_click',
  'hover',
  'focus',
  'type_text',
  'press_keys',
  'select_option',
  'choose_option',
  'attach_document',
  'calendar_open_event_editor',
  'calendar_find_event',
  'scroll',
  'drag',
  'click_at',
  'double_click_at',
  'drag_at',
  'type_at',
  'transfer_code',
  'start_timed_repeat',
]);

export const VISUAL_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'click_at',
  'double_click_at',
  'drag_at',
  'type_at',
]);

/** Read-only tools answered from the user's saved account data, never from page content. */
export const PROFILE_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'get_candidate_profile',
  'search_cv',
  'list_documents',
]);

export function recordFieldsToObject(fields: RecordInput['fields']): Record<string, string> {
  return Array.isArray(fields)
    ? Object.fromEntries(fields.map((field) => [field.name, field.value]))
    : { ...fields };
}
