import { PlannerRequestSchema, ScopeRequestSchema } from '@nudge/contracts';
import { z } from 'zod';

const ExtensionIdSchema = z.string().regex(/^[a-p]{32}$/);
const IdSchema = z.string().min(1).max(80);
const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input_text'), text: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('input_image'), image_url: z.string().max(6_000_000).regex(/^data:image\/(?:png|jpeg|webp|gif);base64,/) }).strict(),
]);
const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'developer']),
  content: z.union([z.string().min(1).max(4000), z.array(ContentPartSchema).min(1).max(5)]),
});

export const HostRequestSchema = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), extensionId: ExtensionIdSchema, id: IdSchema, type: z.literal('plan'), accountId: IdSchema, model: z.string().min(1).max(200), request: PlannerRequestSchema }).strict(),
  z.object({ v: z.literal(1), extensionId: ExtensionIdSchema, id: IdSchema, type: z.literal('scope'), accountId: IdSchema, model: z.string().min(1).max(200), request: ScopeRequestSchema }).strict(),
  z.object({ v: z.literal(1), extensionId: ExtensionIdSchema, id: IdSchema, type: z.literal('status') }).strict(),
  z.object({
    v: z.literal(1),
    extensionId: ExtensionIdSchema,
    id: IdSchema,
    type: z.literal('connect'),
    accountId: z.string().min(1).max(80).optional(),
    newAccount: z.boolean().optional(),
    enablePlan: z.boolean().optional(),
  }).strict(),
  z.object({
    v: z.literal(1),
    extensionId: ExtensionIdSchema,
    id: IdSchema,
    type: z.literal('disconnect'),
    accountId: z.string().min(1).max(80),
  }).strict(),
  z.object({
    v: z.literal(1),
    extensionId: ExtensionIdSchema,
    id: IdSchema,
    type: z.literal('select'),
    accountId: z.string().min(1).max(80),
  }).strict(),
  z.object({
    v: z.literal(1),
    extensionId: ExtensionIdSchema,
    id: IdSchema,
    type: z.literal('models'),
    accountId: z.string().min(1).max(80),
  }).strict(),
  z.object({
    v: z.literal(1),
    extensionId: ExtensionIdSchema,
    id: IdSchema,
    type: z.literal('respond'),
    accountId: z.string().min(1).max(80),
    model: z.string().min(1).max(200),
    instructions: z.string().min(1).max(12_000),
    messages: z.array(MessageSchema).min(1).max(12),
  }).strict(),
  z.object({
    v: z.literal(1),
    extensionId: ExtensionIdSchema,
    id: IdSchema,
    type: z.literal('cancel'),
    targetId: IdSchema,
  }).strict(),
]);

export type HostRequest = z.infer<typeof HostRequestSchema>;

export function encodeMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message));
  if (payload.length > 1024 * 1024) throw new Error('Native message is too large.');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function pushFrames(
  buffer: Buffer<ArrayBufferLike>,
  onMessage: (message: unknown) => void,
): Buffer<ArrayBufferLike> {
  let rest = buffer;
  while (rest.length >= 4) {
    const length = rest.readUInt32LE(0);
    // Chrome allows up to 64 MiB toward the host; image chat turns need more than 1 MiB.
    if (length <= 0 || length > 32 * 1024 * 1024) throw new Error('Native message length is invalid.');
    if (rest.length < 4 + length) break;
    onMessage(JSON.parse(rest.subarray(4, 4 + length).toString('utf8')));
    rest = rest.subarray(4 + length);
  }
  return rest;
}
