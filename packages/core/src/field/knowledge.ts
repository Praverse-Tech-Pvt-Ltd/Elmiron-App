import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';

/**
 * Approved knowledge — AI-C1, `20260924000600_knowledge.sql`.
 *
 * The store every AI answer about a product must come from. **An AI feature may only be handed
 * text a second person approved, for the market it is asked about, that is in date.**
 *
 *     draft --submit--> in_review --approve--> approved --retire--> retired
 *                                  \--reject--> rejected (terminal)
 *
 * * Submitting freezes the text and cuts it into chunks: what was reviewed is what is retrieved.
 * * **Four eyes**: the author or submitter cannot approve; approval carries a written attestation.
 * * Content about a product must name a market (§47: never assume one country's content applies
 *   everywhere).
 * * Approving retires the previously approved version of the same document for the same market.
 *
 * **Reads** are table reads (snake_case on the wire). An MR sees approved versions only; an admin
 * sees all. **Writes of state** go through `KNOWLEDGE_RPC`. **Search** goes through
 * `search_approved_knowledge` only.
 *
 * Refusals: `28000`, `42501` (not an admin, not your organisation, four-eyes), `22023` (wrong
 * state, no attestation, no reason, empty query).
 */

export const KNOWLEDGE_DOCUMENT_TYPES = [
  'product_label',
  'clinical_study',
  'visual_aid',
  'faq',
  'objection_handling',
  'training_material',
  'compliance_instruction',
  'sop',
  'other',
] as const;
export const KnowledgeDocumentTypeSchema = z.enum(KNOWLEDGE_DOCUMENT_TYPES);
export type KnowledgeDocumentType = z.infer<typeof KnowledgeDocumentTypeSchema>;

export const KNOWLEDGE_VERSION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'rejected',
  'retired',
] as const;
export const KnowledgeVersionStatusSchema = z.enum(KNOWLEDGE_VERSION_STATUSES);
export type KnowledgeVersionStatus = z.infer<typeof KnowledgeVersionStatusSchema>;

// ---------------------------------------------------------------------------
// Entities (table reads)
// ---------------------------------------------------------------------------

export const KnowledgeDocumentSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  title: z.string().min(1),
  documentType: KnowledgeDocumentTypeSchema,
  productId: UuidSchema.nullable(),
  therapyAreaId: UuidSchema.nullable(),
  isActive: z.boolean(),
  createdByUserId: UuidSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export const KnowledgeDocumentVersionSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  documentId: UuidSchema,
  versionNumber: z.number().int().positive(),
  status: KnowledgeVersionStatusSchema,
  /** Null = not market-specific. Never null when the document is about a product. */
  marketId: UuidSchema.nullable(),
  body: z.string().min(1),
  /** Where the text came from — the source document, edition, page. */
  sourceReference: z.string().min(1),
  effectiveFrom: IsoDateSchema,
  /** Past this date the version is excluded from search. Computed at read, never stored. */
  reviewDueOn: IsoDateSchema.nullable(),
  createdByUserId: UuidSchema,
  submittedAt: IsoDateTimeSchema.nullable(),
  submittedByUserId: UuidSchema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  decidedByUserId: UuidSchema.nullable(),
  approvalAttestation: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  retiredAt: IsoDateTimeSchema.nullable(),
  retiredByUserId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type KnowledgeDocumentVersion = z.infer<typeof KnowledgeDocumentVersionSchema>;

export const KnowledgeChunkSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  documentVersionId: UuidSchema,
  position: z.number().int().positive(),
  /** The nearest preceding section heading, for a citation. */
  heading: z.string().nullable(),
  body: z.string().min(1),
  createdAt: IsoDateTimeSchema,
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

export const KNOWLEDGE_RPC = {
  /** Admin. Draft -> in_review; freezes the text and cuts chunks. */
  submitKnowledgeVersion: 'submit_knowledge_version',
  /** Admin who neither wrote nor submitted it. In review -> approved. Attestation required. */
  approveKnowledgeVersion: 'approve_knowledge_version',
  /** Same four-eyes rule. In review -> rejected. Reason required. Terminal. */
  rejectKnowledgeVersion: 'reject_knowledge_version',
  /** Admin. Approved -> retired. */
  retireKnowledgeVersion: 'retire_knowledge_version',
  /** Anyone in the organisation. The only door an AI feature uses. */
  searchApprovedKnowledge: 'search_approved_knowledge',
} as const;

export const SubmitKnowledgeVersionResponseSchema = z.object({
  documentVersionId: UuidSchema,
  status: z.literal('in_review'),
  submittedAt: IsoDateTimeSchema,
  chunkCount: z.number().int().positive(),
});
export type SubmitKnowledgeVersionResponse = z.infer<typeof SubmitKnowledgeVersionResponseSchema>;

export const ApproveKnowledgeVersionRequestSchema = z.object({
  p_version_id: UuidSchema,
  p_attestation: z.string().trim().min(1),
});
export const ApproveKnowledgeVersionResponseSchema = z.object({
  documentVersionId: UuidSchema,
  status: z.literal('approved'),
  decidedAt: IsoDateTimeSchema,
  retiredDocumentVersionIds: z.array(UuidSchema),
});
export type ApproveKnowledgeVersionResponse = z.infer<typeof ApproveKnowledgeVersionResponseSchema>;

export const RejectKnowledgeVersionRequestSchema = z.object({
  p_version_id: UuidSchema,
  p_reason: z.string().trim().min(1),
});
export const RejectKnowledgeVersionResponseSchema = z.object({
  documentVersionId: UuidSchema,
  status: z.literal('rejected'),
  decidedAt: IsoDateTimeSchema,
});
export type RejectKnowledgeVersionResponse = z.infer<typeof RejectKnowledgeVersionResponseSchema>;

export const RetireKnowledgeVersionResponseSchema = z.object({
  documentVersionId: UuidSchema,
  status: z.literal('retired'),
  retiredAt: IsoDateTimeSchema,
});
export type RetireKnowledgeVersionResponse = z.infer<typeof RetireKnowledgeVersionResponseSchema>;

export const SearchApprovedKnowledgeRequestSchema = z.object({
  p_query: z.string().trim().min(1),
  /** Null = only content that names no market, which excludes all product content. */
  p_market_id: UuidSchema.nullish(),
  p_product_id: UuidSchema.nullish(),
  p_limit: z.number().int().min(1).max(20).optional(),
});

export const KnowledgeSearchResultSchema = z.object({
  chunkId: UuidSchema,
  documentId: UuidSchema,
  documentTitle: z.string().min(1),
  documentType: KnowledgeDocumentTypeSchema,
  documentVersionId: UuidSchema,
  versionNumber: z.number().int().positive(),
  marketId: UuidSchema.nullable(),
  productId: UuidSchema.nullable(),
  sourceReference: z.string().min(1),
  heading: z.string().nullable(),
  position: z.number().int().positive(),
  body: z.string().min(1),
  rank: z.number().nonnegative(),
});
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>;

/**
 * `not_available` is an ANSWER, not an error: nothing approved, in date and in scope matched.
 * The AI layer must turn it into "Approved information not available. Please refer this question
 * to the Medical/Scientific team." — never into a best-effort answer.
 */
export const SearchApprovedKnowledgeResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    searchedOn: IsoDateSchema,
    results: z.array(KnowledgeSearchResultSchema).min(1),
  }),
  z.object({
    status: z.literal('not_available'),
    searchedOn: IsoDateSchema,
    results: z.array(KnowledgeSearchResultSchema).length(0),
  }),
]);
export type SearchApprovedKnowledgeResponse = z.infer<typeof SearchApprovedKnowledgeResponseSchema>;

/** The sentence the master prompt §9 requires when `status` is `not_available`. */
export const KNOWLEDGE_NOT_AVAILABLE_MESSAGE =
  'Approved information not available. Please refer this question to the Medical/Scientific team.';
