import { z } from 'zod';

import { PageSnapshotSchema } from './page';

export const ScreenshotFrameSchema = z
  .object({
    screenshotId: z.string().min(1).max(120),
    tabId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(120),
    url: z.string().min(1).max(2_000),
    capturedAt: z.number().int().nonnegative(),
    viewport: z
      .object({
        cssWidth: z.number().positive().finite(),
        cssHeight: z.number().positive().finite(),
        devicePixelRatio: z.number().positive().finite(),
        scrollX: z.number().finite(),
        scrollY: z.number().finite(),
      })
      .strict(),
    imageWidth: z.number().int().nonnegative(),
    imageHeight: z.number().int().nonnegative(),
    coordinateSpace: z.literal('css_viewport'),
    mutationCounterAtCapture: z.number().int().nonnegative(),
  })
  .strict();

export const ObservationSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    snapshot: PageSnapshotSchema,
    screenshot: z
      .object({
        frame: ScreenshotFrameSchema,
        dataUrl: z.string().startsWith('data:image/').max(8_000_000),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ScreenshotFrame = z.infer<typeof ScreenshotFrameSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
