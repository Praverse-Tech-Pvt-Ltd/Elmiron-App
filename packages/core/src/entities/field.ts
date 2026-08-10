import { z } from 'zod';
import { CoordinatesSchema, IsoDateSchema, IsoDateTimeSchema, UuidSchema } from '../primitives.js';

/**
 * Commercial field entities.
 *
 * There is no patient data anywhere in this file, and there must never be.
 * `Doctor` carries professional information only — no prescribing volumes,
 * no patient counts, nothing that profiles the doctor.
 */

export const ClinicAddressSchema = z.object({
  id: UuidSchema,
  doctorId: UuidSchema,
  label: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  /** Geofence centre for check-in. `null` until someone captures it in the field. */
  coordinates: CoordinatesSchema.nullable(),
  geofenceRadiusMetres: z.number().positive(),
});
export type ClinicAddress = z.infer<typeof ClinicAddressSchema>;

export const DoctorSchema = z.object({
  id: UuidSchema,
  fullName: z.string().min(1),
  /** State medical council registration number. */
  registrationNumber: z.string().nullable(),
  specialty: z.string().nullable(),
  qualification: z.string().nullable(),
  territoryId: UuidSchema,
  assignedMrId: UuidSchema.nullable(),
  clinicAddresses: z.array(ClinicAddressSchema),
  isActive: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Doctor = z.infer<typeof DoctorSchema>;

export const BeatPlanStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected']);
export type BeatPlanStatus = z.infer<typeof BeatPlanStatusSchema>;

export const BeatPlanEntrySchema = z.object({
  id: UuidSchema,
  beatPlanId: UuidSchema,
  doctorId: UuidSchema,
  clinicAddressId: UuidSchema.nullable(),
  plannedSequence: z.number().int().nonnegative(),
});
export type BeatPlanEntry = z.infer<typeof BeatPlanEntrySchema>;

export const BeatPlanSchema = z.object({
  id: UuidSchema,
  mrId: UuidSchema,
  territoryId: UuidSchema,
  planDate: IsoDateSchema,
  status: BeatPlanStatusSchema,
  approvedByUserId: UuidSchema.nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
  entries: z.array(BeatPlanEntrySchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type BeatPlan = z.infer<typeof BeatPlanSchema>;

export const VisitStatusSchema = z.enum(['planned', 'in_progress', 'completed', 'cancelled']);
export type VisitStatus = z.infer<typeof VisitStatusSchema>;

export const VisitSchema = z.object({
  id: UuidSchema,
  mrId: UuidSchema,
  doctorId: UuidSchema,
  /** `null` for an unplanned visit. Unplanned visits are legitimate. */
  beatPlanId: UuidSchema.nullable(),
  clinicAddressId: UuidSchema.nullable(),
  status: VisitStatusSchema,
  scheduledFor: IsoDateTimeSchema.nullable(),
  startedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  /** When the server took delivery. Server-stamped; a supplied value is discarded. */
  receivedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Visit = z.infer<typeof VisitSchema>;

/** How the position fix was obtained relative to the clinic geofence. */
export const GeofenceStatusSchema = z.enum(['inside', 'outside', 'unavailable']);
export type GeofenceStatus = z.infer<typeof GeofenceStatusSchema>;

/** Whether the geofence fired it or the MR pressed a button. Both are recorded. */
export const CaptureSourceSchema = z.enum(['automatic', 'manual']);
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;

export const CheckInSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  mrId: UuidSchema,
  coordinates: CoordinatesSchema,
  /** Computed server-side from the clinic coordinates. Never sent by the client. */
  geofenceStatus: GeofenceStatusSchema,
  /** Computed server-side. A client-reported distance is an expense claim it wrote itself. */
  distanceFromClinicMetres: z.number().nonnegative().nullable(),
  source: CaptureSourceSchema,
  /** What the device says. Its clock is not trusted. */
  occurredAt: IsoDateTimeSchema,
  /** When the server took delivery. Use both to reconcile a late sync. */
  receivedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type CheckIn = z.infer<typeof CheckInSchema>;

export const CheckOutSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  mrId: UuidSchema,
  coordinates: CoordinatesSchema,
  geofenceStatus: GeofenceStatusSchema,
  distanceFromClinicMetres: z.number().nonnegative().nullable(),
  source: CaptureSourceSchema,
  occurredAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
  /** Seconds since the visit's earliest check-in. Null until one arrives. */
  durationSeconds: z.number().int().nonnegative().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type CheckOut = z.infer<typeof CheckOutSchema>;

export const CallReportStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected']);
export type CallReportStatus = z.infer<typeof CallReportStatusSchema>;

/** Whether the draft came from the MR typing or from their voice note. */
export const CallReportDraftSourceSchema = z.enum(['manual', 'voice_note']);
export type CallReportDraftSource = z.infer<typeof CallReportDraftSourceSchema>;

export const CallReportSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  /** The MR who authored it. A manager approves; a manager never authors. */
  mrId: UuidSchema,
  summary: z.string(),
  productIdsDiscussed: z.array(UuidSchema),
  objectionsRaised: z.string().nullable(),
  nextStep: z.string().nullable(),
  status: CallReportStatusSchema,
  draftSource: CallReportDraftSourceSchema,
  approvedByUserId: UuidSchema.nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
  receivedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CallReport = z.infer<typeof CallReportSchema>;

export const SampleOrInputKindSchema = z.enum(['sample', 'input']);
export type SampleOrInputKind = z.infer<typeof SampleOrInputKindSchema>;

export const SampleAndInputSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  mrId: UuidSchema,
  doctorId: UuidSchema,
  kind: SampleOrInputKindSchema,
  itemName: z.string().min(1),
  quantity: z.number().int().positive(),
  /** UCPMP caps are enforced server-side; this is the declared value in INR. */
  declaredValueInr: z.number().nonnegative(),
  occurredAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type SampleAndInput = z.infer<typeof SampleAndInputSchema>;

/**
 * Working hours, per territory, inherited down the territory tree.
 *
 * The app shows the MR their own window so a refused capture has an explanation
 * rather than an error code. A territory with no window of its own resolves to the
 * nearest ancestor that has one; if none does, capture is refused outright.
 */
export const TerritoryShiftWindowSchema = z.object({
  id: UuidSchema,
  territoryId: UuidSchema,
  /** Local wall-clock time, `HH:MM:SS`, in `timezone`. */
  shiftStart: z.string(),
  shiftEnd: z.string(),
  /** IANA name, e.g. `Asia/Kolkata`. Windows are evaluated in this zone, not UTC. */
  timezone: z.string().min(1),
  graceMinutes: z.number().int().nonnegative(),
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. */
  activeWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type TerritoryShiftWindow = z.infer<typeof TerritoryShiftWindowSchema>;

/**
 * A day's travel, computed server-side from stored check-in coordinates ordered by
 * `occurredAt`. This feeds the MR's expense claim, so it is never derived from a
 * client-reported distance and it is visible to the MR.
 */
export const MileageDaySchema = z.object({
  mrId: UuidSchema,
  travelDate: IsoDateSchema,
  checkInCount: z.number().int().nonnegative(),
  distanceMetres: z.number().nonnegative(),
});
export type MileageDay = z.infer<typeof MileageDaySchema>;
