import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';
import { KnowledgeVersionStatusSchema } from './knowledge.js';

/**
 * AI Doctor — practice simulation, and the coach analysis of it. W1-D Part B.
 *
 * **What this is for, in one sentence:** a rep rehearses a detailing conversation against a
 * **synthetic** doctor, and afterwards gets feedback on how they did.
 *
 * **What it is NOT, and this is asserted by a test rather than promised here** (`W1-D B6`):
 *
 * * **no real doctor.** A persona is authored content. Nothing in this file references
 *   `public.doctors`, `visits`, `consent_records` or `analyses`, and the migration carries no
 *   foreign key to any of them.
 * * **no recording.** A turn is text. There is no audio column, no storage key, no upload grant.
 *   `C21` keeps consultation recording off, and voice practice needs a vendor `#5` has not chosen.
 * * **no patient data.** `C25` forbids it, and the gateway's `detectPatientSignals` refuses a turn
 *   carrying it **before** any provider call — the same guardrail `product_qa` uses, not a copy.
 *
 * ## The approval rule applies to a persona and a scenario
 *
 * **A persona and a scenario are CONTENT, so `C24`'s never-born-approved rule reaches them.** They
 * carry the same lifecycle as approved knowledge — `draft → in_review → approved → retired`, with
 * `rejected` terminal — the same four-eyes requirement, and the same stored written attestation.
 * **`KnowledgeVersionStatusSchema` is imported rather than redeclared**, so the two cannot drift.
 *
 * Why that matters here specifically: a scenario is what the model is told to *be*. An unapproved
 * scenario is an unapproved prompt with extra steps, and `#5` is not the only thing standing between
 * a model and a rep.
 */

// ---------------------------------------------------------------------------
// Personas and scenarios — admin-editable content (D1)
// ---------------------------------------------------------------------------

/**
 * How the synthetic doctor behaves. Deliberately a small closed set rather than free text: the
 * value is passed into a prompt, and an admin typing a paragraph here would be writing prompt text
 * through a field that has no approval of its own.
 */
export const SIM_PERSONA_STANCES = ['receptive', 'sceptical', 'rushed', 'hostile'] as const;
export const SimPersonaStanceSchema = z.enum(SIM_PERSONA_STANCES);
export type SimPersonaStance = z.infer<typeof SimPersonaStanceSchema>;

export const SimPersonaSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  /** Shown to the rep. A LABEL, never a real doctor's name — asserted in the migration's comment. */
  displayName: z.string().min(1),
  specialty: z.string().min(1),
  stance: SimPersonaStanceSchema,
  /** The authored brief the model is given. Frozen on submit, like a knowledge version's body. */
  brief: z.string().min(1),
  status: KnowledgeVersionStatusSchema,
  /** W1-A E1's rule, extended here: a model-drafted persona must say so. */
  authorship: z.enum(['human', 'ai_generated']),
  authoringModel: z.string().nullable(),
  createdByUserId: UuidSchema,
  submittedByUserId: UuidSchema.nullable(),
  decidedByUserId: UuidSchema.nullable(),
  approvalAttestation: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SimPersona = z.infer<typeof SimPersonaSchema>;

export const SimScenarioSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  personaId: UuidSchema,
  title: z.string().min(1),
  /** What the rep is meant to achieve. Shown to them before they start. */
  objective: z.string().min(1),
  /** The objection the persona will raise. The thing the practice is actually for. */
  objection: z.string().min(1),
  /** Optional: a scenario may be product-specific or general. */
  productId: UuidSchema.nullable(),
  /** Required when `productId` is set — §47, the same rule approved knowledge carries. */
  marketId: UuidSchema.nullable(),
  status: KnowledgeVersionStatusSchema,
  authorship: z.enum(['human', 'ai_generated']),
  authoringModel: z.string().nullable(),
  createdByUserId: UuidSchema,
  submittedByUserId: UuidSchema.nullable(),
  decidedByUserId: UuidSchema.nullable(),
  approvalAttestation: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SimScenario = z.infer<typeof SimScenarioSchema>;

// ---------------------------------------------------------------------------
// The session and its turns (D2)
// ---------------------------------------------------------------------------

export const SIM_SESSION_STATES = ['open', 'ended'] as const;
export const SimSessionStateSchema = z.enum(SIM_SESSION_STATES);

export const SimSessionSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  /** The rep. A session belongs to one person and is never reassigned. */
  mrId: UuidSchema,
  scenarioId: UuidSchema,
  personaId: UuidSchema,
  productId: UuidSchema.nullable(),
  marketId: UuidSchema.nullable(),
  /** Which APPROVED prompt version the doctor's turns were generated under. */
  promptVersionId: UuidSchema,
  /**
   * The approved knowledge versions the doctor's replies drew on, accumulated across turns.
   * §7–§9: *"Historical AI interactions must be traceable to the knowledge version used."*
   */
  knowledgeVersionIds: z.array(UuidSchema),
  state: SimSessionStateSchema,
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema.nullable(),
  turnCount: z.number().int().nonnegative(),
});
export type SimSession = z.infer<typeof SimSessionSchema>;

export const SIM_TURN_ROLES = ['rep', 'doctor'] as const;
export const SimTurnRoleSchema = z.enum(SIM_TURN_ROLES);

export const SimTurnSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  sessionId: UuidSchema,
  /** 1-based, contiguous, server-assigned. A client cannot choose where its turn lands. */
  turnIndex: z.number().int().positive(),
  role: SimTurnRoleSchema,
  text: z.string().min(1),
  /**
   * The `ai_requests` row for the doctor turn this rep turn produced. Null on a rep turn that was
   * refused by the guardrail before any request began, and null on the doctor turn itself.
   */
  aiRequestId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type SimTurn = z.infer<typeof SimTurnSchema>;

// ---------------------------------------------------------------------------
// THE COACH ANALYSIS CONTRACT (D4) — written before anything can produce one
// ---------------------------------------------------------------------------

/**
 * The five things a practice session is scored on.
 *
 * **A closed set, and that is the point.** If a model could invent a dimension, two analyses would
 * not be comparable and no screen could label them. `ai_complete_request` already refuses an
 * invented flag for the same reason (`23514`).
 */
export const SIM_COACH_DIMENSIONS = [
  'opening',
  'product_knowledge',
  'objection_handling',
  'communication',
  'closing',
] as const;
export const SimCoachDimensionSchema = z.enum(SIM_COACH_DIMENSIONS);
export type SimCoachDimension = z.infer<typeof SimCoachDimensionSchema>;

/**
 * One piece of feedback, and **it must cite the turn it is about.**
 *
 * `packages/core/src/field/analysis.ts` already refuses a finding with no citation, for real-visit
 * analyses. The same rule holds here and for the same reason: *"a finding always carries its
 * evidence"*. A model that cannot point at the turn it is describing is guessing, and an
 * unciteable criticism is one a rep cannot check or argue with.
 */
export const SimCoachFindingSchema = z.object({
  dimension: SimCoachDimensionSchema,
  /** A short label. Shown in a list. */
  title: z.string().min(1),
  detail: z.string().min(1),
  /** The turn this is about. Validated server-side against the session's real turns. */
  turnIndex: z.number().int().positive(),
});
export type SimCoachFinding = z.infer<typeof SimCoachFindingSchema>;

/** 0–100 integer. A closed range so a model cannot return 7/10 and be read as 7%. */
const ScoreSchema = z.number().int().min(0).max(100);

/**
 * **The shape a coach analysis must have, validated server-side before it is stored.**
 *
 * ## Why scores are permitted here, when `constraints.md` forbids them elsewhere
 *
 * `.ai-collab/constraints.md` says: *"Never add a ranking, score, rank, percentile or grade to
 * `analyses` or the manager surface."* **Both halves of that are respected and neither is bent.**
 *
 * * **This is not `analyses`.** That table holds analyses of REAL doctor visits, which is employee
 *   monitoring (`C8`). This is a practice session the rep chose to run against a synthetic persona.
 * * **This is not a manager surface.** `C27` rules that practice scores are visible to **the MR
 *   themselves and the company admin, and to nobody else** — no manager, no team averages, no
 *   rankings. That is enforced in RLS, not here, because **a client-side filter is not a
 *   permission** (`constraints.md`: RLS is the enforcement layer).
 *
 * **There is deliberately no team, cohort, percentile, rank or comparison field anywhere in this
 * shape.** A score with nothing to compare it against cannot become a leaderboard by someone
 * writing a `GROUP BY`, and `contract.test.ts` asserts the absence by name.
 */
export const SimCoachAnalysisSchema = z.object({
  id: UuidSchema,
  organisationId: UuidSchema,
  sessionId: UuidSchema,
  /** The rep the session belonged to. Denormalised so RLS can scope without a join. */
  mrId: UuidSchema,
  /** 0–100. What the rep sees. Not a grade, not a percentile, not a rank. */
  overallScore: ScoreSchema,
  /** One score per dimension. All five required: a missing dimension is a silent zero otherwise. */
  dimensionScores: z.object({
    opening: ScoreSchema,
    product_knowledge: ScoreSchema,
    objection_handling: ScoreSchema,
    communication: ScoreSchema,
    closing: ScoreSchema,
  }),
  /** At least one of each. An analysis that only criticises, or only praises, is not feedback. */
  strengths: z.array(SimCoachFindingSchema).min(1),
  improvements: z.array(SimCoachFindingSchema).min(1),
  /** Two or three sentences the rep reads first. */
  summary: z.string().min(1),
  /** Which approved prompt produced it, and which model. `stub` while `#5` is open. */
  promptVersionId: UuidSchema,
  modelProvider: z.string(),
  modelName: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type SimCoachAnalysis = z.infer<typeof SimCoachAnalysisSchema>;

/**
 * What the MODEL must return, which is a strict subset of the row above.
 *
 * The model supplies judgement; the server supplies identity, provenance and timestamps. A model
 * that could set `sessionId` or `promptVersionId` could attribute its output to another session.
 */
export const SimCoachOutputSchema = z.object({
  overallScore: ScoreSchema,
  dimensionScores: SimCoachAnalysisSchema.shape.dimensionScores,
  strengths: z.array(SimCoachFindingSchema).min(1),
  improvements: z.array(SimCoachFindingSchema).min(1),
  summary: z.string().min(1),
});
export type SimCoachOutput = z.infer<typeof SimCoachOutputSchema>;
export const SIM_COACH_OUTPUT_SCHEMA_NAME = 'SimCoachOutputSchema';

/** What the model must return for one doctor turn. Small on purpose. */
export const SimDoctorTurnOutputSchema = z.object({
  reply: z.string().min(1),
  /** True when the persona considers the objection answered. Ends nothing; the rep decides. */
  objectionAddressed: z.boolean(),
});
export type SimDoctorTurnOutput = z.infer<typeof SimDoctorTurnOutputSchema>;
export const SIM_DOCTOR_TURN_OUTPUT_SCHEMA_NAME = 'SimDoctorTurnOutputSchema';

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

export const SIMULATION_RPC = {
  /** Admin. Draft -> in_review, for a persona or a scenario. Freezes the authored text. */
  submitSimContent: 'submit_sim_content',
  /** Admin who neither wrote nor submitted it. Attestation required. */
  approveSimContent: 'approve_sim_content',
  /** Same four-eyes rule. Reason required. Terminal. */
  rejectSimContent: 'reject_sim_content',
  /** Anyone, for themselves, on an APPROVED scenario. */
  startSimSession: 'start_sim_session',
  /** The gateway, as the user. Appends a rep turn and a doctor turn. */
  recordSimTurn: 'record_sim_turn',
  /** The owner of the session. Idempotent. */
  endSimSession: 'end_sim_session',
  /** The gateway, as the user, once per session. Validates the shape above. */
  recordSimCoachAnalysis: 'record_sim_coach_analysis',
} as const;

export const StartSimSessionResponseSchema = z.object({
  sessionId: UuidSchema,
  personaId: UuidSchema,
  personaDisplayName: z.string(),
  personaStance: SimPersonaStanceSchema,
  objective: z.string(),
  objection: z.string(),
  /** The approved prompt version the session is pinned to for its whole life. */
  promptVersionId: UuidSchema,
  startedAt: IsoDateTimeSchema,
});

export const RecordSimTurnResponseSchema = z.object({
  sessionId: UuidSchema,
  repTurnIndex: z.number().int().positive(),
  doctorTurnIndex: z.number().int().positive(),
  turnCount: z.number().int().positive(),
});

export const EndSimSessionResponseSchema = z.object({
  sessionId: UuidSchema,
  state: z.literal('ended'),
  endedAt: IsoDateTimeSchema,
  turnCount: z.number().int().nonnegative(),
});

export const RecordSimCoachAnalysisResponseSchema = z.object({
  analysisId: UuidSchema,
  sessionId: UuidSchema,
  overallScore: ScoreSchema,
});

/** The rep-facing outcome of one turn, from the gateway. Mirrors `ProductQaResult`'s shape. */
export type SimTurnResult =
  | {
      readonly kind: 'replied';
      readonly sessionId: string;
      readonly reply: string;
      readonly objectionAddressed: boolean;
      readonly turnCount: number;
    }
  | { readonly kind: 'patient_specific'; readonly sessionId: string; readonly message: string }
  | { readonly kind: 'failed'; readonly sessionId: string; readonly message: string };

export const SIM_TURN_FAILED_MESSAGE =
  'The practice doctor could not answer just now. Your session is still open — try again.';
