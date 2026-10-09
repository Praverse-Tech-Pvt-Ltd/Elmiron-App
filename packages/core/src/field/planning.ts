import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';
import { VisitOriginSchema, VisitStatusSchema } from './entities.js';

/**
 * `BE-W171` / `BE-C78` — manager planning (`20261009000200_manager_planning`).
 *
 * A FIELD MANAGER plans a rep's day; an ADMIN grants a manager planning scope beyond their own
 * territory subtree and never plans. Every write is one of these RPCs; there is no table write. The
 * schemas below parse exactly what each RPC returns, so the console and the tests read one shape.
 */
export const PLANNING_RPC = {
  /** Field manager. Writes the next plan version for one rep and day. Idempotent on `p_request_id`. */
  planMrDay: 'plan_mr_day',
  /** Field manager. Moves selected unstarted planned visits to another rep. Idempotent per request. */
  reassignPlannedVisits: 'reassign_planned_visits',
  /** Admin. Dated, reasoned extra planning scope for one manager over a territory and its subtree. */
  grantPlanningAccess: 'grant_planning_access',
  /** Admin. Ends a grant. Revoking twice returns the first revocation. */
  revokePlanningAccess: 'revoke_planning_access',
  /** Field manager. The reps they may plan on a date, own subtree and grants alike. */
  plannableReps: 'plannable_reps',
  /** Field manager. The doctors that may go on one rep's plan on a date. */
  plannableDoctors: 'plannable_doctors',
  /** Field manager. A rep's plans and visits over up to 32 days, by origin. */
  managerDayReview: 'manager_day_review',
  /** Field manager. Records that an unplanned visit was reviewed. Once per reviewer. */
  reviewUnplannedVisit: 'review_unplanned_visit',
} as const;

/** One stop on a plan, in route order. */
export const PlanStopSchema = z.object({
  doctorId: UuidSchema,
  clinicAddressId: UuidSchema.nullable().optional(),
});
export type PlanStop = z.infer<typeof PlanStopSchema>;

/** What `plan_mr_day` answers. `unchanged`: identical to the current version, nothing written. */
export const PlanSummarySchema = z.object({
  beatPlanId: UuidSchema,
  version: z.number().int().positive(),
  unchanged: z.boolean(),
  /** The same `p_request_id` was already applied; this is the first answer, nothing re-written. */
  replayed: z.boolean(),
  visitsCreated: z.number().int().nonnegative().optional(),
  visitsMoved: z.number().int().nonnegative().optional(),
  visitsCancelled: z.number().int().nonnegative().optional(),
  visitsKept: z.number().int().nonnegative().optional(),
});
export type PlanSummary = z.infer<typeof PlanSummarySchema>;

export const ReassignResultSchema = z.object({
  replayed: z.boolean(),
  reassigned: z
    .array(z.object({ fromVisitId: UuidSchema, toVisitId: UuidSchema }))
    .nullable()
    .transform((pairs) => pairs ?? []),
});
export type ReassignResult = z.infer<typeof ReassignResultSchema>;

export const PlannableRepSchema = z.object({
  mr_id: UuidSchema,
  full_name: z.string(),
  territory_id: UuidSchema,
  territory_name: z.string(),
  /** True when the rep is reachable only through an admin's grant, not the manager's own subtree. */
  via_grant: z.boolean(),
});
export type PlannableRep = z.infer<typeof PlannableRepSchema>;

export const PlannableDoctorSchema = z.object({
  doctor_id: UuidSchema,
  full_name: z.string(),
  specialty: z.string().nullable(),
  clinics: z.array(z.object({ id: UuidSchema, label: z.string(), city: z.string() })),
});
export type PlannableDoctor = z.infer<typeof PlannableDoctorSchema>;

export const ReviewVisitSchema = z.object({
  visitId: UuidSchema,
  doctorId: UuidSchema,
  doctorName: z.string(),
  origin: VisitOriginSchema,
  status: VisitStatusSchema,
  beatPlanId: UuidSchema.nullable(),
  plannedDate: IsoDateSchema.nullable(),
  visitDay: IsoDateSchema.nullable(),
  startedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  notMetReason: z.string().nullable(),
  unplannedReason: z.string().nullable(),
  reviewedByMe: z.boolean(),
  /** Set when this visit was reassigned away: the rep it went to. */
  reassignedTo: UuidSchema.nullable(),
});
export type ReviewVisit = z.infer<typeof ReviewVisitSchema>;

export const ReviewPlanSchema = z.object({
  beatPlanId: UuidSchema,
  planDate: IsoDateSchema,
  version: z.number().int().positive(),
  plannedBy: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  entries: z.array(
    z.object({
      doctorId: UuidSchema,
      doctorName: z.string(),
      clinicAddressId: UuidSchema.nullable(),
      sequence: z.number().int().nonnegative(),
    }),
  ),
});
export type ReviewPlan = z.infer<typeof ReviewPlanSchema>;

/** What `manager_day_review` answers. */
export const DayReviewSchema = z.object({
  mrId: UuidSchema,
  fullName: z.string(),
  /** The rep's today, in the rep's territory zone -- the day a plan may no longer be written before. */
  today: IsoDateSchema,
  plans: z.array(ReviewPlanSchema),
  visits: z.array(ReviewVisitSchema),
});
export type DayReview = z.infer<typeof DayReviewSchema>;

/** A `planning_territory_grants` row: what `grant_planning_access` returns and what an admin reads. */
export const PlanningGrantSchema = z.object({
  id: UuidSchema,
  organisation_id: UuidSchema,
  manager_id: UuidSchema,
  territory_id: UuidSchema,
  valid_from: IsoDateSchema,
  valid_until: IsoDateSchema.nullable(),
  reason: z.string(),
  granted_by_user_id: UuidSchema,
  created_at: IsoDateTimeSchema,
});
export type PlanningGrant = z.infer<typeof PlanningGrantSchema>;

/** A `planning_territory_grant_revocations` row: what `revoke_planning_access` returns. */
export const PlanningGrantRevocationSchema = z.object({
  id: UuidSchema,
  grant_id: UuidSchema,
  revoked_by_user_id: UuidSchema,
  reason: z.string(),
  created_at: IsoDateTimeSchema,
});
export type PlanningGrantRevocation = z.infer<typeof PlanningGrantRevocationSchema>;

/** Where a grant stands on a given day. Revoked wins over dates: a revocation is permanent. */
export const grantState = (
  grant: Pick<PlanningGrant, 'valid_from' | 'valid_until'>,
  revoked: boolean,
  today: string,
): 'revoked' | 'ended' | 'not_started' | 'active' => {
  if (revoked) return 'revoked';
  if (grant.valid_until !== null && grant.valid_until < today) return 'ended';
  if (grant.valid_from > today) return 'not_started';
  return 'active';
};

/** An `unplanned_visit_reviews` row: what `review_unplanned_visit` returns. */
export const UnplannedVisitReviewSchema = z.object({
  id: UuidSchema,
  visit_id: UuidSchema,
  reviewer_id: UuidSchema,
  note: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export type UnplannedVisitReview = z.infer<typeof UnplannedVisitReviewSchema>;
