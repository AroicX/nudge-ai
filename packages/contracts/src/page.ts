import { z } from 'zod';

const HttpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Only HTTP(S) URLs are allowed');

export const ElementIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[^:]+:\d+$/);

export const PageElementSchema = z
  .object({
    id: ElementIdSchema,
    kind: z.enum([
      'heading',
      'text',
      'link',
      'button',
      'input',
      'textarea',
      'select',
      'option',
      'dialog',
      'checkbox',
      'gridcell',
      'menuitem',
      'tab',
      'canvas',
      'editable',
      'combobox',
      'listbox',
      'file',
    ]),
    role: z.string().min(1).max(80).optional(),
    name: z.string().max(500).optional(),
    text: z.string().max(1_000).optional(),
    href: HttpUrlSchema.optional(),
    label: z.string().max(500).optional(),
    inputType: z.string().max(80).optional(),
    value: z.string().max(2_000).optional(),
    checked: z.boolean().optional(),
    selected: z.boolean().optional(),
    options: z.array(z.string().max(500)).max(200).optional(),
    contentEditable: z.boolean().optional(),
    expanded: z.boolean().optional(),
    pressed: z.boolean().optional(),
    scrollable: z.boolean().optional(),
    formHasSensitiveField: z.boolean().optional(),
    /** Form semantics so the agent can map fields and see validation state. */
    required: z.boolean().optional(),
    invalid: z.boolean().optional(),
    placeholder: z.string().max(300).optional(),
    description: z.string().max(500).optional(),
    autocomplete: z.string().max(80).optional(),
    /** File inputs: names of currently attached files (never contents). */
    files: z.array(z.string().max(250)).max(10).optional(),
    /** True when the element is inside the active modal dialog. */
    inDialog: z.boolean().optional(),
    /** Same-origin frame or open shadow root path the element was found in. */
    frame: z.string().max(300).optional(),
    visible: z.boolean(),
    disabled: z.boolean(),
    rect: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().nonnegative().finite(),
        height: z.number().nonnegative().finite(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PageSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1).max(120),
    documentId: z.string().min(1).max(120),
    capturedAt: z.iso.datetime(),
    url: HttpUrlSchema,
    title: z.string().max(1_000),
    viewport: z
      .object({
        width: z.number().positive().finite(),
        height: z.number().positive().finite(),
        scrollX: z.number().nonnegative().finite(),
        scrollY: z.number().nonnegative().finite(),
        pageHeight: z.number().nonnegative().finite(),
      })
      .strict(),
    elements: z.array(PageElementSchema).max(250),
    text: z.array(z.string().max(2_000)).max(200),
    truncated: z.boolean(),
    mutationCounter: z.number().int().nonnegative().optional(),
    inaccessible: z
      .array(
        z.enum(['cross_origin_frame', 'closed_shadow_root', 'canvas', 'browser_page', 'unknown']),
      )
      .max(50),
    /** The open modal dialog, when one is active; its controls are listed first. */
    dialog: z
      .object({ elementId: ElementIdSchema.optional(), name: z.string().max(300).optional() })
      .strict()
      .optional(),
    /** Visible validation and alert messages (role=alert, aria-invalid descriptions). */
    validation: z.array(z.string().max(500)).max(30).optional(),
    /** Cross-origin frames cannot be read; their address lets the agent open them directly. */
    frames: z
      .array(z.object({ src: z.string().max(2_000), title: z.string().max(300).optional() }).strict())
      .max(20)
      .optional(),
    focusedElementId: ElementIdSchema.optional(),
    /** Stable hash of the meaningful page state, used for no-progress detection. */
    stateHash: z.string().max(40).optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const prefix = `${snapshot.documentId}:`;
    snapshot.elements.forEach((element, index) => {
      if (!element.id.startsWith(prefix)) {
        context.addIssue({
          code: 'custom',
          message: 'Element ID must be scoped to the current document',
          path: ['elements', index, 'id'],
        });
      }
    });
  });

export type PageElement = z.infer<typeof PageElementSchema>;
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
