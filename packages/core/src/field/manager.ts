import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../shared/primitives.js';
import { CallReportCurrentSchema, DoctorSchema } from './entities.js';

/**
 * The manager surface.
 *
 * Exception-first: a field manager oversees 8–15 MRs and wants what is off-plan,
 * not an activity feed.
 *
 * Nothing in this file ranks medical representatives against one another. There is
 * no score, no rank, no percentile and no league table, and a consent rate that
 * differs from the team is labelled `data_quality` because that is what it is —
 * an MR at 100% while the team sits at 40% is a fraud signal, not a performance
 * win. Adding an ordering here would invert the meaning of the whole surface.
 */

export const SearchDoctorsResponseSchema = z.object({
  items: z.array(DoctorSchema),
  /** True when results were capped. A silent cap lets an MR believe a partial list is complete. */
  truncated: z.boolean(),
  limit: z.number().int().positive(),
});
export type SearchDoctorsResponse = z.infer<typeof SearchDoctorsResponseSchema>;

export const TeamActivityRowSchema = z.object({
  mrId: UuidSchema,
  territoryId: UuidSchema.nullable(),
  plannedVisitCount: z.number().int().nonnegative(),
  actualVisitCount: z.number().int().nonnegative(),
  checkInCount: z.number().int().nonnegative(),
  /** Drawn only from captures inside the configured shift window. */
  lastLatitude: z.number().nullable(),
  lastLongitude: z.number().nullable(),
  lastSeenAt: IsoDateTimeSchema.nullable(),
  lastSuccessfulSyncAt: IsoDateTimeSchema.nullable(),
});
export type TeamActivityRow = z.infer<typeof TeamActivityRowSchema>;

export const CoverageRowSchema = z.object({
  mrId: UuidSchema,
  coverageDate: IsoDateSchema,
  plannedVisitCount: z.number().int().nonnegative(),
  actualVisitCount: z.number().int().nonnegative(),
  /** Planned doctors with no completed visit that day — not a count difference. */
  missedVisitCount: z.number().int().nonnegative(),
});
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

export const TeamExceptionKindSchema = z.enum([
  'missed_visits',
  'no_recent_sync',
  'high_rejection_rate',
  'consent_rate_anomaly',
]);
export type TeamExceptionKind = z.infer<typeof TeamExceptionKindSchema>;

export const TeamExceptionSchema = z.object({
  mrId: UuidSchema,
  exceptionKind: TeamExceptionKindSchema,
  /** Shape varies by kind. A consent anomaly always carries `signal: 'data_quality'`. */
  detail: z.record(z.string(), z.unknown()),
});
export type TeamException = z.infer<typeof TeamExceptionSchema>;

export const BulkApprovalResultSchema = z.object({
  id: UuidSchema,
  decided: z.boolean(),
  error: z.string().nullable(),
});
export type BulkApprovalResult = z.infer<typeof BulkApprovalResultSchema>;

export const BulkApprovalResponseSchema = z.object({
  results: z.array(BulkApprovalResultSchema),
  serverTime: IsoDateTimeSchema,
});
export type BulkApprovalResponse = z.infer<typeof BulkApprovalResponseSchema>;

export const OverdueCallReportSchema = z.object({
  callReportId: UuidSchema,
  mrId: UuidSchema,
  visitId: UuidSchema,
  submittedAt: IsoDateTimeSchema,
});
export type OverdueCallReport = z.infer<typeof OverdueCallReportSchema>;

export const ApprovableCallReportSchema = CallReportCurrentSchema;
export type ApprovableCallReport = z.infer<typeof ApprovableCallReportSchema>;
