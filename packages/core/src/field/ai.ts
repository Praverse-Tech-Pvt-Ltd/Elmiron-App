import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';
import { KnowledgeVersionStatusSchema } from './knowledge.js';

/**
 * The AI control plane — AI-D0, `20260924000700_ai_control_plane.sql`.
 *
 * The database half of the gateway (master prompt §3, §36, §42, §52). Whatever runs the model —
 * D1 is still open — calls `ai_begin_request` before it and `ai_complete_request` after it,
 * **as the signed-in user**. No client calls a model vendor directly, ever.
 *
 * **A feature runs only when** its flag `ai_feature_enabled:<feature>` is true, the organisation
 * has an APPROVED prompt for it, and `ai_daily_requests_per_user` is set. Otherwise
 * `ai_begin_request` refuses with `45011` → `ai_feature_disabled`. A used-up allowance is `45012`
 * → `ai_rate_limited`. Both are in `refusals.ts`.
 *
 * **Prompts** follow the approved-knowledge lifecycle: draft → in review → approved / rejected →
 * retired, four eyes, attestation, one approved version per organisation per feature. Admins
 * only — an MR cannot read a system prompt.
 *
 * **The request log holds no conversation.** Identifiers, counts, timings and flags only (§52).
 */

/** `patient_education` is deliberately absent: X1 puts patient-facing AI in the clinical project. */
export const AI_FEATURES = [
  'mr_chat',
  'product_qa',
  'scientific_qa',
  'lms_tutor',
  'ai_doctor',
  'ai_coach',
  'assessment_grader',
  'transcript_analysis',
  'pv_screening',
  'complaint_screening',
  'content_recommendation',
  'manager_insights',
] as const;
export const AiFeatureSchema = z.enum(AI_FEATURES);
export type AiFeature = z.infer<typeof AiFeatureSchema>;

export const AI_REQUEST_STATUSES = ['started', 'completed', 'failed', 'blocked'] as const;
export const AiRequestStatusSchema = z.enum(AI_REQUEST_STATUSES);
export type AiRequestStatus = z.infer<typeof AiRequestStatusSchema>;

/**
 * A closed vocabulary of signals for a human queue. Never a judgement: there is no severity,
 * confidence or score beside a flag, the rule `adverse_event_reports` already follows.
 */
export const AI_REQUEST_FLAGS = [
  'knowledge_not_available',
  'schema_invalid',
  'guardrail_triggered',
  'patient_identifier_detected',
  'possible_adverse_event',
  'possible_quality_complaint',
  'off_label_request',
  'provider_timeout',
  'provider_error',
  /** W1-S B (`BE-C64`): the vendor reported the model declined — not malformed output. */
  'model_refused',
  /** W1-W C (`BE-C67`): the vendor reported the answer stopped at a length limit — cut off, not malformed. */
  'output_truncated',
] as const;
export const AiRequestFlagSchema = z.enum(AI_REQUEST_FLAGS);
export type AiRequestFlag = z.infer<typeof AiRequestFlagSchema>;

/** `app_thresholds` keys the control plane reads. All GLOBAL rows until BE-W106 is decided. */
export const aiFeatureFlagKey = (feature: AiFeature): string => `ai_feature_enabled:${feature}`;
export const AI_DAILY_LIMIT_KEY = 'ai_daily_requests_per_user';

// ---------------------------------------------------------------------------
// Entities (table reads)
// ---------------------------------------------------------------------------

export const AiPromptVersionSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  feature: AiFeatureSchema,
  versionNumber: z.number().int().positive(),
  status: KnowledgeVersionStatusSchema,
  systemPrompt: z.string().min(1),
  /** The name of the Zod schema in this package the output is validated against. */
  outputSchemaName: z
    .string()
    .regex(/^[A-Z][A-Za-z0-9]*Schema$/)
    .nullable(),
  modelConfig: z.record(z.string(), z.unknown()),
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
export type AiPromptVersion = z.infer<typeof AiPromptVersionSchema>;

/** Readable by the user it belongs to and by their organisation's admin. Not by a manager. */
export const AiRequestSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  userId: UuidSchema,
  feature: AiFeatureSchema,
  promptVersionId: UuidSchema,
  status: AiRequestStatusSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  modelProvider: z.string().nullable(),
  modelName: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  knowledgeVersionIds: z.array(UuidSchema),
  flags: z.array(AiRequestFlagSchema),
  errorCode: z.string().nullable(),
});
export type AiRequest = z.infer<typeof AiRequestSchema>;

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

export const AI_RPC = {
  submitAiPromptVersion: 'submit_ai_prompt_version',
  approveAiPromptVersion: 'approve_ai_prompt_version',
  rejectAiPromptVersion: 'reject_ai_prompt_version',
  retireAiPromptVersion: 'retire_ai_prompt_version',
  /** The gateway, as the user, before the model call. */
  aiBeginRequest: 'ai_begin_request',
  /** The gateway, as the same user, after it. Once. */
  aiCompleteRequest: 'ai_complete_request',
} as const;

export const SubmitAiPromptVersionResponseSchema = z.object({
  promptVersionId: UuidSchema,
  status: z.literal('in_review'),
  submittedAt: IsoDateTimeSchema,
});
export const ApproveAiPromptVersionResponseSchema = z.object({
  promptVersionId: UuidSchema,
  status: z.literal('approved'),
  decidedAt: IsoDateTimeSchema,
  retiredPromptVersionIds: z.array(UuidSchema),
});
export const RejectAiPromptVersionResponseSchema = z.object({
  promptVersionId: UuidSchema,
  status: z.literal('rejected'),
  decidedAt: IsoDateTimeSchema,
});
export const RetireAiPromptVersionResponseSchema = z.object({
  promptVersionId: UuidSchema,
  status: z.literal('retired'),
  retiredAt: IsoDateTimeSchema,
});

export const AiBeginRequestRequestSchema = z.object({ p_feature: AiFeatureSchema });
export const AiBeginRequestResponseSchema = z.object({
  requestId: UuidSchema,
  feature: AiFeatureSchema,
  startedAt: IsoDateTimeSchema,
  promptVersionId: UuidSchema,
  promptVersionNumber: z.number().int().positive(),
  systemPrompt: z.string().min(1),
  outputSchemaName: z.string().nullable(),
  modelConfig: z.record(z.string(), z.unknown()),
  requestsUsedToday: z.number().int().positive(),
  dailyLimit: z.number().nonnegative(),
  /**
   * W1-M D1 (`BE-C30`): true once this request reaches `ai_daily_warning_percent` of the daily
   * allowance (80% by the operator's decision). Required, not defaulted: a missing field read as
   * `false` would be the silent case the warning exists to remove. The same crossing is written
   * once per rep per day to `ai_allowance_warnings`, which is what the company admin reads.
   */
  allowanceWarning: z.boolean(),
  /** W1-Q E2 (`20261001000400`): when today's allowance resets — midnight India time after today. */
  allowanceResetsAt: IsoDateTimeSchema,
});
export type AiBeginRequestResponse = z.infer<typeof AiBeginRequestResponseSchema>;

/**
 * W1-P C (`BE-W128`, `BE-C30`) — where the rep stands against today's AI allowance.
 *
 * **The AI gateway attaches this to EVERY 200 response, for every feature**, as `allowance`, so the
 * screen that shows the answer can show the warning beside it without a second call. It is the
 * `ai_begin_request` figures for THIS request: `requestsUsedToday` counts it.
 *
 * * `warning` is the server's judgement (`ai_daily_warning_percent`, 80% by the operator's
 *   decision) — **the client must not recompute it from the two numbers**, because the percentage is
 *   a per-company setting the client cannot see.
 * * At the limit the request is refused instead: HTTP 429, SQLSTATE `45012`, which
 *   `refusalForSqlState` already maps. **Since W1-Q E2 (frontend `FE-CR-6`) the 429 carries
 *   `allowance` too** — the requests already used, the limit, `warning: true`, and when it resets.
 *   On a 429 `requestsUsedToday` counts no new request, so it can be 0 when the limit is 0.
 * * `resetsAt` is the database's own instant — midnight India time after today — never the client's
 *   arithmetic, for the same reason as `warning`.
 */
export const AiAllowanceSchema = z.object({
  requestsUsedToday: z.number().int().nonnegative(),
  dailyLimit: z.number().nonnegative(),
  warning: z.boolean(),
  resetsAt: IsoDateTimeSchema,
});
export type AiAllowance = z.infer<typeof AiAllowanceSchema>;

export const AiCompleteRequestRequestSchema = z.object({
  p_request_id: UuidSchema,
  p_status: z.enum(['completed', 'failed', 'blocked']),
  p_model_provider: z.string().nullable(),
  p_model_name: z.string().nullable(),
  p_input_tokens: z.number().int().nonnegative().nullable(),
  p_output_tokens: z.number().int().nonnegative().nullable(),
  /** Only approved (or since-retired) versions of the caller's organisation are accepted. */
  p_knowledge_version_ids: z.array(UuidSchema).optional(),
  p_flags: z.array(AiRequestFlagSchema).optional(),
  p_error_code: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .nullish(),
});
export const AiCompleteRequestResponseSchema = z.object({
  requestId: UuidSchema,
  status: z.enum(['completed', 'failed', 'blocked']),
  completedAt: IsoDateTimeSchema,
  latencyMs: z.number().int().nonnegative(),
  flags: z.array(AiRequestFlagSchema),
});
export type AiCompleteRequestResponse = z.infer<typeof AiCompleteRequestResponseSchema>;
