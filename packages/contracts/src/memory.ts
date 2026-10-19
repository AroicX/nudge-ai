import { z } from 'zod';
import { PersistedTurnSchema } from './history';

export const MemoryIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w:.-]+$/);
export const MemoryChatSchema = z
  .object({
    id: MemoryIdSchema,
    title: z.string().min(1).max(200),
    createdAt: z.string(),
    updatedAt: z.string(),
    generation: z.number().int().nonnegative(),
  })
  .strict();
export const MemoryFactSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z.string().min(1).max(2000),
    source: z.string().max(500),
    updatedAt: z.string(),
  })
  .strict();
export const MemoryDocumentSchema = z
  .object({
    id: MemoryIdSchema,
    filename: z.string().min(1).max(250),
    text: z.string().max(500_000),
    source: z.string().max(500),
    createdAt: z.string(),
  })
  .strict();
export const MemorySearchResultSchema = z
  .object({
    kind: z.enum(['message', 'document', 'fact']),
    id: z.string(),
    chatId: z.string().optional(),
    title: z.string(),
    text: z.string(),
    source: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export const MemoryMessagesSchema = z
  .object({
    messages: z.array(PersistedTurnSchema).max(500),
    generation: z.number().int().nonnegative(),
  })
  .strict();
export type MemoryChat = z.infer<typeof MemoryChatSchema>;
export type MemoryFact = z.infer<typeof MemoryFactSchema>;
export type MemoryDocument = z.infer<typeof MemoryDocumentSchema>;
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

/** Where a candidate-profile value came from. Every extracted value keeps its source. */
export const ProfileSourceSchema = z
  .object({
    kind: z.enum(['document', 'profile']),
    documentId: z.string().max(160).optional(),
    filename: z.string().max(250).optional(),
    /** Short excerpt of the line the value was read from (CV) or the fact source. */
    excerpt: z.string().max(300),
  })
  .strict();

export const ProfileFieldSchema = z
  .object({
    value: z.string().max(2_000),
    /** `conflict`: sources disagree; the agent must ask instead of choosing. */
    status: z.enum(['found', 'conflict']),
    sources: z.array(ProfileSourceSchema).min(1).max(6),
    alternatives: z
      .array(z.object({ value: z.string().max(2_000), source: ProfileSourceSchema }).strict())
      .max(6)
      .optional(),
  })
  .strict();

export const ProfileEntrySchema = z
  .object({ text: z.string().max(500), source: ProfileSourceSchema })
  .strict();

export const CandidateDocumentSchema = z
  .object({
    id: MemoryIdSchema,
    filename: z.string().max(250),
    createdAt: z.string(),
    isDefault: z.boolean(),
    looksLikeCv: z.boolean(),
    /** Whether the original file bytes are stored, so it can be attached to a form. */
    attachable: z.boolean(),
    parseStatus: z.enum(['parsed', 'partial', 'empty']),
  })
  .strict();

export const CANDIDATE_FIELD_KEYS = [
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'location',
  'linkedin',
  'github',
  'portfolio',
  'current_title',
  'current_employer',
] as const;

export const CandidateProfileSchema = z
  .object({
    status: z.enum(['ready', 'partial', 'no_documents', 'needs_selection']),
    selectedDocumentId: MemoryIdSchema.optional(),
    selection: z.enum(['default', 'only_cv', 'most_recent_cv', 'none']),
    documents: z.array(CandidateDocumentSchema).max(100),
    fields: z.record(z.string().max(40), ProfileFieldSchema),
    employment: z.array(ProfileEntrySchema).max(20),
    education: z.array(ProfileEntrySchema).max(20),
    skills: z.array(z.string().max(80)).max(60),
    /** Supported fields not present in any source. */
    missing: z.array(z.string().max(40)).max(20),
    /** Answers that must never be inferred from a CV; ask the user. */
    askUser: z.array(z.string().max(80)).max(20),
    notes: z.array(z.string().max(300)).max(20),
  })
  .strict();

export type ProfileSource = z.infer<typeof ProfileSourceSchema>;
export type ProfileField = z.infer<typeof ProfileFieldSchema>;
export type ProfileEntry = z.infer<typeof ProfileEntrySchema>;
export type CandidateDocument = z.infer<typeof CandidateDocumentSchema>;
export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
