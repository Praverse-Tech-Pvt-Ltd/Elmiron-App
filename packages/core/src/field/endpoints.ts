import { z } from 'zod';
import {
  CoordinatesSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  LanguageTagSchema,
  UuidSchema,
} from '../shared/primitives.js';
import { TerritorySchema, UserProfileSchema } from '../shared/identity.js';
import {
  BeatPlanSchema,
  BeatPlanStatusSchema,
  CallReportSchema,
  CaptureSourceSchema,
  CheckInSchema,
  CheckOutSchema,
  ClinicAddressSchema,
  DoctorSchema,
  GeofenceStatusSchema,
  MileageDaySchema,
  VisitStatusSchema,
  SampleAndInputSchema,
  SampleOrInputKindSchema,
  TerritoryShiftWindowSchema,
  VisitSchema,
} from './entities.js';
import type { CheckIn, CheckOut, ClinicAddress, MileageDay, Visit } from './entities.js';
import { ConsentOutcomeSchema, ConsentRecordSchema, ConsentTextVersionSchema } from './consent.js';
import type { ConsentTextVersion } from './consent.js';
import { RecordingSchema, TranscriptSchema, VoiceNoteSchema } from './capture.js';
import { UploadSessionStateSchema } from './upload.js';
import { AnalysisOverrideSchema, AnalysisSchema } from './analysis.js';
import {
  ServerSyncStatusSchema,
  SyncEntitySchema,
  SyncOperationSchema,
  SyncQueueItemSchema,
  SyncQueueStatusSchema,
  SyncRejectionCodeSchema,
} from './sync.js';
import { PageRequestSchema, pageResponseSchema } from '../shared/pagination.js';

/**
 * Request and response shapes for every endpoint the MR app will have, including
 * the ones that do not exist yet. The week-2 mock server conforms to this file, and
 * the frontend builds against the mock for twelve weeks.
 *
 * Endpoints not yet implemented are marked with the week they land in.
 * The path constants live next to their schemas so the mock server and the client
 * cannot drift apart.
 */

// ---------------------------------------------------------------------------
// Session and identity — week 1
// ---------------------------------------------------------------------------

export const GetMeResponseSchema = z.object({
  profile: UserProfileSchema,
  /** Territories this user may read. One entry for an MR, a subtree for a manager. */
  visibleTerritoryIds: z.array(UuidSchema),
});
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;

export const ListTerritoriesResponseSchema = pageResponseSchema(TerritorySchema);
export type ListTerritoriesResponse = z.infer<typeof ListTerritoriesResponseSchema>;

// ---------------------------------------------------------------------------
// Doctors and beat plans — week 3
// ---------------------------------------------------------------------------

export const ListDoctorsRequestSchema = PageRequestSchema.extend({
  territoryId: UuidSchema.nullish(),
  assignedMrId: UuidSchema.nullish(),
  search: z.string().nullish(),
  isActive: z.boolean().nullish(),
});
export type ListDoctorsRequest = z.infer<typeof ListDoctorsRequestSchema>;

export const ListDoctorsResponseSchema = pageResponseSchema(DoctorSchema);
export type ListDoctorsResponse = z.infer<typeof ListDoctorsResponseSchema>;

export const ListBeatPlansRequestSchema = PageRequestSchema.extend({
  mrId: UuidSchema.nullish(),
  fromDate: IsoDateSchema.nullish(),
  toDate: IsoDateSchema.nullish(),
});
export type ListBeatPlansRequest = z.infer<typeof ListBeatPlansRequestSchema>;

export const ListBeatPlansResponseSchema = pageResponseSchema(BeatPlanSchema);
export type ListBeatPlansResponse = z.infer<typeof ListBeatPlansResponseSchema>;

// ---------------------------------------------------------------------------
// Visits, check-in and check-out — weeks 3–4
// ---------------------------------------------------------------------------

export const ListVisitsRequestSchema = PageRequestSchema.extend({
  mrId: UuidSchema.nullish(),
  doctorId: UuidSchema.nullish(),
  fromDate: IsoDateSchema.nullish(),
  toDate: IsoDateSchema.nullish(),
});
export type ListVisitsRequest = z.infer<typeof ListVisitsRequestSchema>;

export const ListVisitsResponseSchema = pageResponseSchema(VisitSchema);
export type ListVisitsResponse = z.infer<typeof ListVisitsResponseSchema>;

export const CreateVisitRequestSchema = z.object({
  /** Device-generated so the offline queue is idempotent. */
  id: UuidSchema,
  doctorId: UuidSchema,
  beatPlanId: UuidSchema.nullish(),
  clinicAddressId: UuidSchema.nullish(),
  scheduledFor: IsoDateTimeSchema.nullish(),
});
export type CreateVisitRequest = z.infer<typeof CreateVisitRequestSchema>;

export const CreateCheckInRequestSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  coordinates: CoordinatesSchema,
  source: CaptureSourceSchema,
  occurredAt: IsoDateTimeSchema,
});
export type CreateCheckInRequest = z.infer<typeof CreateCheckInRequestSchema>;

export const CreateCheckOutRequestSchema = CreateCheckInRequestSchema;
export type CreateCheckOutRequest = z.infer<typeof CreateCheckOutRequestSchema>;

// ---------------------------------------------------------------------------
// Call reports — weeks 5 and 8
// ---------------------------------------------------------------------------

export const CreateCallReportRequestSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  summary: z.string(),
  productIdsDiscussed: z.array(UuidSchema),
  objectionsRaised: z.string().nullish(),
  nextStep: z.string().nullish(),
});
export type CreateCallReportRequest = z.infer<typeof CreateCallReportRequestSchema>;

export const ListCallReportsRequestSchema = PageRequestSchema.extend({
  mrId: UuidSchema.nullish(),
  status: CallReportSchema.shape.status.nullish(),
});
export type ListCallReportsRequest = z.infer<typeof ListCallReportsRequestSchema>;

export const ListCallReportsResponseSchema = pageResponseSchema(CallReportSchema);
export type ListCallReportsResponse = z.infer<typeof ListCallReportsResponseSchema>;

/** A field manager approves. A field manager never authors. */
export const ApproveCallReportRequestSchema = z.object({
  approved: z.boolean(),
  reason: z.string().nullish(),
});
export type ApproveCallReportRequest = z.infer<typeof ApproveCallReportRequestSchema>;

export const CreateSampleAndInputRequestSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  doctorId: UuidSchema,
  kind: SampleOrInputKindSchema,
  itemName: z.string().min(1),
  quantity: z.number().int().positive(),
  declaredValueInr: z.number().nonnegative(),
  occurredAt: IsoDateTimeSchema,
});
export type CreateSampleAndInputRequest = z.infer<typeof CreateSampleAndInputRequestSchema>;

export const ListSamplesAndInputsResponseSchema = pageResponseSchema(SampleAndInputSchema);
export type ListSamplesAndInputsResponse = z.infer<typeof ListSamplesAndInputsResponseSchema>;

// ---------------------------------------------------------------------------
// Working hours and mileage — week 3
// ---------------------------------------------------------------------------

/** The window the caller's captures are validated against. */
export const GetShiftWindowRequestSchema = z.object({
  territoryId: UuidSchema.nullish(),
});
export type GetShiftWindowRequest = z.infer<typeof GetShiftWindowRequestSchema>;

export const GetShiftWindowResponseSchema = z.object({
  /** Null when no window is configured for the territory or any ancestor. Capture
   *  is refused in that state, and the app should say so rather than retry. */
  window: TerritoryShiftWindowSchema.nullable(),
  /** The territory the window was actually resolved from, which may be an ancestor. */
  resolvedFromTerritoryId: UuidSchema.nullable(),
});
export type GetShiftWindowResponse = z.infer<typeof GetShiftWindowResponseSchema>;

export const ListMileageRequestSchema = z.object({
  fromDate: IsoDateSchema,
  toDate: IsoDateSchema,
  mrId: UuidSchema.nullish(),
});
export type ListMileageRequest = z.infer<typeof ListMileageRequestSchema>;

export const ListMileageResponseSchema = z.object({
  days: z.array(MileageDaySchema),
  totalDistanceMetres: z.number().nonnegative(),
});
export type ListMileageResponse = z.infer<typeof ListMileageResponseSchema>;

// ---------------------------------------------------------------------------
// Consent — week 6
// ---------------------------------------------------------------------------

export const GetActiveConsentTextRequestSchema = z.object({
  language: LanguageTagSchema,
});
export type GetActiveConsentTextRequest = z.infer<typeof GetActiveConsentTextRequestSchema>;

export const ListConsentTextVersionsResponseSchema = pageResponseSchema(ConsentTextVersionSchema);
export type ListConsentTextVersionsResponse = z.infer<typeof ListConsentTextVersionsResponseSchema>;

/**
 * All three outcomes post to the same endpoint and all three succeed. There is no
 * separate "decline" endpoint and no error path for declining.
 */
export const CreateConsentRecordRequestSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  doctorId: UuidSchema,
  outcome: ConsentOutcomeSchema,
  notAskedReason: z.string().nullish(),
  consentTextVersionId: UuidSchema,
  displayedLanguage: LanguageTagSchema,
  capturedAt: IsoDateTimeSchema,
});
export type CreateConsentRecordRequest = z.infer<typeof CreateConsentRecordRequestSchema>;

/** Withdrawal creates a new row. The original is never touched. */
export const WithdrawConsentRequestSchema = z.object({
  id: UuidSchema,
  supersedesConsentRecordId: UuidSchema,
  consentTextVersionId: UuidSchema,
  displayedLanguage: LanguageTagSchema,
  capturedAt: IsoDateTimeSchema,
});
export type WithdrawConsentRequest = z.infer<typeof WithdrawConsentRequestSchema>;

export const ListConsentRecordsRequestSchema = PageRequestSchema.extend({
  visitId: UuidSchema.nullish(),
  doctorId: UuidSchema.nullish(),
});
export type ListConsentRecordsRequest = z.infer<typeof ListConsentRecordsRequestSchema>;

export const ListConsentRecordsResponseSchema = pageResponseSchema(ConsentRecordSchema);
export type ListConsentRecordsResponse = z.infer<typeof ListConsentRecordsResponseSchema>;

// ---------------------------------------------------------------------------
// Audio capture and resumable upload — week 7
// ---------------------------------------------------------------------------

export const CreateVoiceNoteRequestSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  durationSeconds: z.number().nonnegative(),
  recordedAt: IsoDateTimeSchema,
  sizeBytes: z.number().int().positive(),
});
export type CreateVoiceNoteRequest = z.infer<typeof CreateVoiceNoteRequestSchema>;

export const CreateRecordingRequestSchema = z.object({
  id: UuidSchema,
  visitId: UuidSchema,
  /** Rejected unless this record's outcome is `consented`. */
  consentRecordId: UuidSchema,
  durationSeconds: z.number().nonnegative(),
  bitrateKbps: z.number().int().positive(),
  recordedAt: IsoDateTimeSchema,
  sizeBytes: z.number().int().positive(),
});
export type CreateRecordingRequest = z.infer<typeof CreateRecordingRequestSchema>;

/**
 * A resumable upload session. The client uploads to `uploadUrl` and can query
 * `uploadedBytes` after a dropped connection to resume from the right offset.
 *
 * BE-W7 added the last two fields, additively. `uploadedBytes` was always the
 * server's count rather than the device's, which is what makes resume work after the
 * app was KILLED and not only after a socket dropped — but the original shape had no
 * way to express either of the two things a client must show an MR:
 *
 *   * `state` — a session can be revoked underneath the device when the doctor
 *     withdraws consent. Without this the client sees an upload that simply stops
 *     working and has nothing true to say about why.
 *   * `hardExpiresAt` — `expiresAt` slides forward on every chunk, so it is not a
 *     deadline, it is a heartbeat timeout. The fixed ceiling is the one that means
 *     "after this, the recording is gone", and it is the one worth showing.
 */
export const UploadSessionSchema = z.object({
  uploadSessionId: UuidSchema,
  uploadUrl: z.url(),
  storageKey: z.string(),
  /** Slides forward on each chunk. A heartbeat timeout, not a deadline. */
  expiresAt: IsoDateTimeSchema,
  uploadedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().positive(),
  state: UploadSessionStateSchema,
  /** Fixed when the session opened. The sliding clock never passes it. */
  hardExpiresAt: IsoDateTimeSchema,
});
export type UploadSession = z.infer<typeof UploadSessionSchema>;

export const CompleteUploadRequestSchema = z.object({
  uploadSessionId: UuidSchema,
  /** SHA-256 of the complete file, hex encoded. */
  checksum: z.string().length(64),
});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

// ---------------------------------------------------------------------------
// Transcripts and analyses — weeks 8–10
// ---------------------------------------------------------------------------

export const ListAnalysesRequestSchema = PageRequestSchema.extend({
  mrId: UuidSchema.nullish(),
  visitId: UuidSchema.nullish(),
  fromDate: IsoDateSchema.nullish(),
  toDate: IsoDateSchema.nullish(),
});
export type ListAnalysesRequest = z.infer<typeof ListAnalysesRequestSchema>;

export const ListAnalysesResponseSchema = pageResponseSchema(AnalysisSchema);
export type ListAnalysesResponse = z.infer<typeof ListAnalysesResponseSchema>;

/** The MR's written reply to their own analysis. Attached, never overwriting. */
export const RespondToAnalysisRequestSchema = z.object({
  response: z.string().min(1),
});
export type RespondToAnalysisRequest = z.infer<typeof RespondToAnalysisRequestSchema>;

export const CreateAnalysisOverrideRequestSchema = z.object({
  findingId: UuidSchema.nullish(),
  reason: z.string().min(1),
});
export type CreateAnalysisOverrideRequest = z.infer<typeof CreateAnalysisOverrideRequestSchema>;

/**
 * The read half of `GET /analyses/:id/overrides`, added in FIX-05.
 *
 * The path has been declared since BE-W6 with only a POST behind it, and until FIX-05
 * there was no table either -- `services/mock` answered the POST with `201` and a
 * fabricated row that `apps/console` rendered. This shape is taken from
 * `public.list_analysis_overrides` rather than invented, so the mock and the database
 * agree: that they did not is the whole of the FIX-03 drift finding.
 *
 * `readAt` and `auditLogId` are not decoration. Every read of an analysis or an
 * override writes an `audit_log` row **before** it returns, and the id of that row comes
 * back with the data so a caller can point at its own read in the trail.
 */
export const ListAnalysisOverridesResponseSchema = z.object({
  data: z.array(AnalysisOverrideSchema),
  readAt: IsoDateTimeSchema,
  auditLogId: z.number().int().positive(),
});
export type ListAnalysisOverridesResponse = z.infer<typeof ListAnalysisOverridesResponseSchema>;

// ---------------------------------------------------------------------------
// Offline sync — week 4
// ---------------------------------------------------------------------------

export const SyncPushItemSchema = z.object({
  id: UuidSchema,
  entity: SyncEntitySchema,
  operation: SyncOperationSchema,
  entityId: UuidSchema,
  payload: z.record(z.string(), z.unknown()),
  clientCreatedAt: IsoDateTimeSchema,
});
export type SyncPushItem = z.infer<typeof SyncPushItemSchema>;

export const SyncPushRequestSchema = z.object({
  /** Device-generated. Re-submitting a whole batch is safe. */
  batchId: UuidSchema,
  items: z.array(SyncPushItemSchema).min(1).max(500),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

/**
 * One verdict per item. Partial success is the normal case: some items in a batch
 * succeed and some do not, and a failure never rolls back the successes.
 */
export const SyncPushResultSchema = z.object({
  id: UuidSchema,
  status: ServerSyncStatusSchema,
  /** Machine-readable. Null unless the status is `rejected` or `dead_lettered`. */
  rejectionCode: SyncRejectionCodeSchema.nullable(),
  /**
   * BE-W75 — the raw SQLSTATE, beside `rejectionCode` rather than instead of it.
   *
   * `SyncRejectionCodeSchema` is a **coarse category** — "not yours", "malformed",
   * "missing reference" — and has no member meaning *the notice changed*, *the UCPMP cap*,
   * *your clock is wrong* or *sync sooner*. So `45001`, `45004`, `45007` and `45008` all
   * arrive as `internal_error`, and five sessions of error-contract work were reachable
   * only on a path nothing used.
   *
   * **Prefer this over `rejectionCode` when it is present**, and pass it to
   * `refusalForSqlState`, which is the one derivation `error-contract.spec.ts` guards in
   * both directions. `null` on an accepted item — so absence means success — and `null` on
   * a dead-letter replay, where the code is read back from `sync_items` and the original
   * SQLSTATE was never stored.
   */
  sqlState: z.string().nullable(),
  /**
   * BE-W97 — the raiser's `DETAIL`, verbatim.
   *
   * Every `450xx` in this schema is raised with figures attached:
   * `45004` carries *"cap 1, already given 0, this entry 2, period starting 2026-09-01"*,
   * `45008` carries *"captured 3 days ago, the maximum is 72 hours"*. `sync_push` read only
   * `MESSAGE_TEXT` out of `get stacked diagnostics`, so all of it died in the handler and a
   * refusal reached the MR as a sentence with no numbers in it.
   *
   * **Render it. Never parse it.** It is prose written by the raise site and it is not a
   * contract — `refusalForSqlState(sqlState)` is the one derivation that decides anything,
   * and `error-contract.spec.ts` guards that in both directions. A client reading server
   * prose to make a decision is the defect FIX-06 minted `45002`/`45003` to remove.
   *
   * `null` on an accepted item, on a malformed item (raised by `sync_push` itself, so
   * nothing is stacked), and on a dead-letter replay — `sync_items` stores the message and
   * nothing else, exactly as with `sqlState`.
   */
  sqlDetail: z.string().nullable(),
  /** BE-W97 — the raiser's `HINT`. Same rules as `sqlDetail`: rendered, never parsed. */
  sqlHint: z.string().nullable(),
  /** Human-readable detail for support. Not for display to the MR unmodified. */
  rejectionDetail: z.string().nullable(),
  /** Accepted, but with something the MR should know — e.g. `stale_beat_plan`. */
  warnings: z.array(z.string()),
});
export type SyncPushResult = z.infer<typeof SyncPushResultSchema>;

export const SyncPushResponseSchema = z.object({
  batchId: UuidSchema,
  results: z.array(SyncPushResultSchema),
  serverTime: IsoDateTimeSchema,
});

export const SyncQueueStatusResponseSchema = z.object({
  queues: z.array(SyncQueueStatusSchema),
});
export type SyncQueueStatusResponse = z.infer<typeof SyncQueueStatusResponseSchema>;
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

/**
 * BE-W61 — what a PULL can carry, which is not what a PUSH can carry.
 *
 * `SyncEntitySchema` is the outbox's list: things a handset creates and sends. A pull is
 * the other direction — things the SERVER changes that an MR needs to be told about — and
 * the two sets are not the same. Reusing the push enum would have meant adding
 * `beat_plan` and `doctor` to the list of things a device may claim to have created,
 * which is a widening of the write surface to buy a name for a read.
 */
/**
 * What `sync_pull` can carry.
 *
 * **`clinic_address` joined in MR-11 (BE-W87).** A doctor payload is `to_jsonb(d)` — the
 * row and nothing else — so it has never carried addresses, while four read paths and the
 * geofence need them. It is a separate entity rather than a nested field because the
 * cursor is `(updated_at, id)`: a nested payload would only sync a clinic edit if
 * something bumped the DOCTOR's `updated_at`, which is a trigger-maintained coupling that,
 * if ever missed, means the edit never syncs and nothing reports it.
 *
 * This enum is the client half of that decision, and `sync-pull-contract.spec.ts` fails
 * the build in both directions — it caught this file being left behind within a minute of
 * the migration landing.
 */
export const SyncPullEntitySchema = z.enum([
  'visit',
  'beat_plan',
  'doctor',
  'clinic_address',
  // MR-26 B1. The consent NOTICE, so a doctor can be asked with no signal. Server-issued,
  // tenant-scoped by a RESTRICTIVE policy, immutable except for retirement. NOT the consent
  // RECORD, which stays out of the pull for MR-12 Q4's reason: ~3,000 audit rows a day for
  // reinstall-only value.
  'consent_text_version',
]);
export type SyncPullEntity = z.infer<typeof SyncPullEntitySchema>;

/**
 * Why this is an opaque cursor and not the `since: IsoDateTime` the contract had.
 *
 * A timestamp cannot express a position inside a group of rows sharing one `updated_at`,
 * so `hasMore` was unactionable — the next page either repeated rows or skipped them.
 * Worse, `updated_at` is stamped at TRANSACTION START, so a transaction that begins
 * before a pull and commits after it writes a row the pull cannot see and the next
 * watermark has already passed: **lost permanently**, and discovered months later as "a
 * visit that never synced".
 *
 * The server therefore issues a cursor carrying transaction snapshots. It is opaque on
 * purpose: a client that parses it will eventually depend on its shape, and the shape has
 * to change when tombstones arrive. Store it, send it back, do not read it.
 */
export const SyncCursorSchema = z.string().min(1);

export const SyncPullRequestSchema = z.object({
  /** Null for a full initial pull. Otherwise the `nextCursor` from the last response. */
  cursor: SyncCursorSchema.nullish(),
  entities: z.array(SyncPullEntitySchema).nullish(),
  limit: z.number().int().min(1).max(500).nullish(),
});
export type SyncPullRequest = z.infer<typeof SyncPullRequestSchema>;

/**
 * Why a change carries a `reason` rather than `deleted: boolean`.
 *
 * A boolean has to stand for three different events — a record destroyed on retention, a
 * record whose consent was withdrawn, and a record that simply stopped being this MR's —
 * and a client cannot tell them apart. One is a retention event and one is not, and
 * telling an MR that a consent record was *deleted* when it was merely reassigned is
 * false in a direction that matters.
 *
 * **Phase 1 emits `upserted` and nothing else.** The other two are declared because the
 * server will emit them and a client should be written to switch on the field rather than
 * on its own version number — but see `completeness` before assuming they can arrive.
 */
export const SyncChangeReasonSchema = z.enum(['upserted', 'deleted', 'out_of_scope']);
export type SyncChangeReason = z.infer<typeof SyncChangeReasonSchema>;

/**
 * **The response says what it is not.**
 *
 * `docs/adr-sync-pull.md` §4: an updates-only pull is worth shipping first, and worse
 * than nothing if it ships silently, because an MR watching their list update will
 * reasonably conclude it is current — and a stale doctor on a beat plan is a wasted visit
 * rather than a cosmetic bug.
 *
 * So incompleteness is a REQUIRED FIELD, not a comment and not an optional hint. A client
 * that parses a response receives it whether or not it thought to ask, and can decide
 * what to show without knowing which server version it is talking to.
 */
export const SyncCompletenessSchema = z.object({
  phase: z.number().int().positive(),
  /** Change kinds this response reflects. */
  reflects: z.array(z.enum(['insert', 'update', 'delete', 'out_of_scope'])),
  /** Change kinds it does NOT. Non-empty means the client's view will drift. */
  omits: z.array(z.enum(['insert', 'update', 'delete', 'out_of_scope'])),
  entities: z.array(SyncPullEntitySchema),
  /** Entities this pull does not carry at all, whatever was asked for. */
  omittedEntities: z.array(z.string()),
  note: z.string(),
});
export type SyncCompleteness = z.infer<typeof SyncCompletenessSchema>;

export const SyncPullResponseSchema = z.object({
  changes: z.array(
    z.object({
      entity: SyncPullEntitySchema,
      entityId: UuidSchema,
      reason: SyncChangeReasonSchema,
      payload: z.record(z.string(), z.unknown()).nullable(),
      updatedAt: IsoDateTimeSchema,
    }),
  ),
  /**
   * The server's clock, for display and for skew detection.
   *
   * **Not the thing to store as a watermark.** It looks like one and is exactly the trap
   * described on `SyncCursorSchema`. Persist `nextCursor`.
   */
  serverTime: IsoDateTimeSchema,
  hasMore: z.boolean(),
  /** Always present. Send it back verbatim; never construct one. */
  nextCursor: SyncCursorSchema,
  completeness: SyncCompletenessSchema,
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const API_PATHS = {
  me: '/me',
  territories: '/territories',
  doctors: '/doctors',
  doctor: (id: string) => `/doctors/${id}`,
  beatPlans: '/beat-plans',
  beatPlan: (id: string) => `/beat-plans/${id}`,
  visits: '/visits',
  visit: (id: string) => `/visits/${id}`,
  // Direct writes to these two are REFUSED by the API. Capture carries validity
  // rules — work hours, geofence, duration — that a row-level policy cannot express,
  // so it goes through the RPCs below and the table path was withdrawn in BE-W3.
  checkIns: '/check-ins',
  checkOuts: '/check-outs',
  recordCheckIn: '/rpc/record_check_in',
  recordCheckOut: '/rpc/record_check_out',
  shiftWindow: '/shift-window',
  mileage: '/mileage',
  callReports: '/call-reports',
  callReportApproval: (id: string) => `/call-reports/${id}/approval`,
  samplesAndInputs: '/samples-and-inputs',
  consentTextVersions: '/consent-text-versions',
  consentTextActive: '/consent-text-versions/active',
  consentRecords: '/consent-records',
  consentWithdrawals: '/consent-records/withdrawals',
  voiceNotes: '/voice-notes',
  recordings: '/recordings',
  uploadSession: (id: string) => `/uploads/${id}`,
  uploadCompletion: '/uploads/completion',
  transcript: (id: string) => `/transcripts/${id}`,
  analyses: '/analyses',
  analysis: (id: string) => `/analyses/${id}`,
  analysisResponse: (id: string) => `/analyses/${id}/response`,
  analysisOverrides: (id: string) => `/analyses/${id}/overrides`,
  syncPush: '/rpc/sync_push',
  syncPull: '/sync/pull',
  syncQueueStatus: '/rpc/sync_queue_status',
  syncRejections: '/rpc/list_sync_rejections',
  reinstateSyncItem: '/rpc/reinstate_sync_item',
  searchDoctors: '/rpc/search_doctors',
  teamActivity: '/rpc/team_activity',
  teamExceptions: '/rpc/team_exceptions',
  coverage: '/rpc/coverage',
  mrActivityDetail: '/rpc/mr_activity_detail',
  approvableCallReports: '/rpc/approvable_call_reports',
  approveCallReportsBulk: '/rpc/approve_call_reports_bulk',
  overdueCallReports: '/rpc/overdue_call_reports',
  myShiftWindow: '/rpc/my_shift_window',
} as const;

export const EntityResponseSchemas = {
  visit: VisitSchema,
  checkIn: CheckInSchema,
  checkOut: CheckOutSchema,
  callReport: CallReportSchema,
  consentRecord: ConsentRecordSchema,
  consentTextVersion: ConsentTextVersionSchema,
  voiceNote: VoiceNoteSchema,
  recording: RecordingSchema,
  transcript: TranscriptSchema,
  analysis: AnalysisSchema,
  analysisOverride: AnalysisOverrideSchema,
  sampleAndInput: SampleAndInputSchema,
  syncQueueItem: SyncQueueItemSchema,
  doctor: DoctorSchema,
  beatPlan: BeatPlanSchema,
  territory: TerritorySchema,
  userProfile: UserProfileSchema,
  territoryShiftWindow: TerritoryShiftWindowSchema,
  mileageDay: MileageDaySchema,
} as const;

// ---------------------------------------------------------------------------
// RPC bodies — week 3 onward
// ---------------------------------------------------------------------------

/**
 * PostgREST passes an RPC body straight through as named arguments, so these keys
 * are the Postgres parameter names rather than the camelCase the rest of this file
 * uses. The mapping is confined to this package on purpose: the leak stops here.
 */
export const RecordCheckInBodySchema = z.object({
  p_id: UuidSchema,
  p_visit_id: UuidSchema,
  p_latitude: z.number().min(-90).max(90),
  p_longitude: z.number().min(-180).max(180),
  p_occurred_at: IsoDateTimeSchema,
  p_accuracy_metres: z.number().nonnegative().nullish(),
  p_source: CaptureSourceSchema.nullish(),
});
export type RecordCheckInBody = z.infer<typeof RecordCheckInBodySchema>;

export const RecordCheckOutBodySchema = RecordCheckInBodySchema;
export type RecordCheckOutBody = z.infer<typeof RecordCheckOutBodySchema>;

export const toRecordCheckInBody = (input: CreateCheckInRequest): RecordCheckInBody => ({
  p_id: input.id,
  p_visit_id: input.visitId,
  p_latitude: input.coordinates.latitude,
  p_longitude: input.coordinates.longitude,
  p_occurred_at: input.occurredAt,
  p_accuracy_metres: input.coordinates.accuracyMetres,
  p_source: input.source,
});

/**
 * The row `record_check_in` actually returns, as PostgREST serialises it.
 *
 * Measured against the running stack in FIX-06 rather than assumed:
 *
 * ```json
 * {"id":"...","visit_id":"...","mr_id":"...","latitude":18.52,"longitude":73.85,
 *  "accuracy_metres":null,"geofence_status":"unavailable",
 *  "distance_from_clinic_metres":null,"source":"automatic",
 *  "occurred_at":"2026-09-07T06:30:00+00:00","created_at":"...","received_at":"...",
 *  "shift_window_source":"territory"}
 * ```
 *
 * Three things the contract's `CheckIn` does not share with it: snake_case keys, flat
 * `latitude`/`longitude` where the entity nests `coordinates`, and `shift_window_source`,
 * which the entity has no field for. A request mapper existed since BE-W3; nothing ever
 * mapped the response, because until FIX-06 no client had ever received one.
 */
export const CheckInRowSchema = z.object({
  id: UuidSchema,
  visit_id: UuidSchema,
  mr_id: UuidSchema,
  latitude: z.number(),
  longitude: z.number(),
  accuracy_metres: z.number().nullable(),
  geofence_status: GeofenceStatusSchema,
  distance_from_clinic_metres: z.number().nullable(),
  source: CaptureSourceSchema,
  occurred_at: IsoDateTimeSchema,
  received_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
});
export type CheckInRow = z.infer<typeof CheckInRowSchema>;

/**
 * `check_ins` row to `CheckIn`.
 *
 * Parses rather than casts. A row that does not match is a contract violation and should
 * throw here, at the edge, rather than surface three screens later as an undefined field.
 */
export const fromCheckInRow = (row: unknown): CheckIn => {
  const parsed = CheckInRowSchema.parse(row);
  return CheckInSchema.parse({
    id: parsed.id,
    visitId: parsed.visit_id,
    mrId: parsed.mr_id,
    coordinates: {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracyMetres: parsed.accuracy_metres,
      // The row has no separate column: `occurred_at` IS when the device took the fix.
      capturedAt: parsed.occurred_at,
    },
    geofenceStatus: parsed.geofence_status,
    distanceFromClinicMetres: parsed.distance_from_clinic_metres,
    source: parsed.source,
    occurredAt: parsed.occurred_at,
    receivedAt: parsed.received_at,
    createdAt: parsed.created_at,
  });
};

/**
 * A visit as PostgREST accepts and returns it.
 *
 * FIX-07. Unlike check-in, a visit is written straight to the table -- `visits` has
 * INSERT, SELECT and UPDATE policies and the grants to match, so there is no RPC in the
 * way and no server-side rule the client could skip.
 *
 * **`mr_id` is absent from the request on purpose.** `CreateVisitRequestSchema` has never
 * declared it, and the insert policy requires `mr_id = auth.uid()`. Migration
 * `20260907000600` gives the column that default, so the caller cannot assert its own
 * identity and cannot assert anyone else's. Sending it would be the client claiming
 * something the server already knows.
 */
export const VisitRowSchema = z.object({
  id: UuidSchema,
  mr_id: UuidSchema,
  doctor_id: UuidSchema,
  beat_plan_id: UuidSchema.nullable(),
  clinic_address_id: UuidSchema.nullable(),
  status: VisitStatusSchema,
  /**
   * `to_jsonb(row)` is an implicit `select *`, so this column reached every handset the
   * day the migration created it. Declared here rather than left to be dropped silently
   * -- `sync-pull-contract.spec.ts` failed on exactly that and is why it is here.
   */
  not_met_reason: z.string().nullable(),
  scheduled_for: IsoDateTimeSchema.nullable(),
  started_at: IsoDateTimeSchema.nullable(),
  completed_at: IsoDateTimeSchema.nullable(),
  received_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type VisitRow = z.infer<typeof VisitRowSchema>;

/**
 * FIX-14 C4 — the two row shapes a `sync_pull` payload actually carries.
 *
 * **A pull payload is a ROW, and `Doctor` and `BeatPlan` are AGGREGATES.** `sync_pull`
 * returns `to_jsonb(d)` for a doctor, which is the `doctors` table and nothing else —
 * while `DoctorSchema` requires `clinicAddresses`, which lives in `clinic_addresses`, and
 * `BeatPlanSchema` requires `entries`, which lives in `beat_plan_entries`. Neither can be
 * built from a pull.
 *
 * **Which side is right: both, about different things.** The aggregates are right about
 * what a doctor is on a doctor screen. The pull is right that it carries rows — joining
 * the children in would change what the payload means, would cross a second table's RLS,
 * and would make every beat-plan change re-send its whole entry list. So the row types are
 * named rather than the aggregates weakened, exactly as `VisitRowSchema` already does, and
 * a consumer that needs the full aggregate reads the children separately.
 *
 * `Visit` needs no such split: every field `VisitSchema` declares is a column on `visits`,
 * which is why `fromVisitRow` has worked since FIX-07.
 *
 * **`organisation_id` is parsed and dropped.** It is a real column and the payload carries
 * it, because `to_jsonb(d)` is an implicit `select *` — so the app receives an
 * organisation id it has no use for, and any column added to `doctors` in future reaches
 * every handset without anybody deciding it should. Registered as BE-W71; dropping it here
 * is the client half.
 */
export const DoctorRowSchema = z.object({
  id: UuidSchema,
  full_name: z.string().min(1),
  registration_number: z.string().nullable(),
  specialty: z.string().nullable(),
  qualification: z.string().nullable(),
  territory_id: UuidSchema,
  assigned_mr_id: UuidSchema.nullable(),
  organisation_id: UuidSchema,
  is_active: z.boolean(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type DoctorRow = z.infer<typeof DoctorRowSchema>;

/** `Doctor` minus the children a row cannot carry. */
export const DoctorRecordSchema = DoctorSchema.omit({ clinicAddresses: true });
export type DoctorRecord = z.infer<typeof DoctorRecordSchema>;

export const fromDoctorRow = (row: unknown): DoctorRecord => {
  const parsed = DoctorRowSchema.parse(row);
  return DoctorRecordSchema.parse({
    id: parsed.id,
    fullName: parsed.full_name,
    registrationNumber: parsed.registration_number,
    specialty: parsed.specialty,
    qualification: parsed.qualification,
    territoryId: parsed.territory_id,
    assignedMrId: parsed.assigned_mr_id,
    isActive: parsed.is_active,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
};

/**
 * A `clinic_addresses` row as `to_jsonb(row)` returns it.
 *
 * **MR-11 / BE-W87.** The pull carries clinic addresses as their own entity, so the client
 * assembles `Doctor.clinicAddresses` from two streams rather than receiving it built. That
 * is the cost of the design and it is paid here: one more row schema and one more mapper.
 *
 * **`coordinates` maps to `null`, and that is a divergence rather than a shortcut.**
 *
 * `CoordinatesSchema` requires `accuracyMetres` and `capturedAt` — it models *a GPS fix
 * somebody took*. A clinic address's latitude and longitude are a **geofence centre**,
 * which nobody captured, at no particular moment, with no accuracy. The table has no such
 * columns and should not: they would describe provenance that does not exist.
 *
 * Filling them in would be fabrication of the `sizeBytes: 1` kind — a value invented to
 * satisfy a shape. So this carries `null` and loses nothing: **the client never reads a
 * clinic address's coordinates.** The geofence is computed server-side inside
 * `record_check_in`, which reads `clinic_addresses` directly; the only `.coordinates` the
 * app consumes is the MR's own fix on a check-in.
 *
 * **Verdict: the CONTRACT is wrong**, and the fix is a geofence-centre type distinct from
 * a captured fix. Registered rather than done here, because it touches the mock and the
 * UI and this migration is about the pull. Until then a clinic arrives with a name, an
 * address and no centre — which is exactly what the client uses.
 */
export const ClinicAddressRowSchema = z.object({
  id: UuidSchema,
  doctor_id: UuidSchema,
  label: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().nullable(),
  city: z.string().min(1),
  state: z.string().min(1),
  postal_code: z.string().min(1),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  geofence_radius_metres: z.number().positive(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type ClinicAddressRow = z.infer<typeof ClinicAddressRowSchema>;

/**
 * A `consent_text_versions` row, as PostgREST returns it — MR-23 B1.
 *
 * **`organisation_id` is deliberately not carried.** The client never filters by tenant:
 * `consent_text_versions_tenant_boundary` is a RESTRICTIVE policy (BE-W79) and
 * `consent_text_versions_select_own_tenant` is the permissive one, so a row that arrives
 * has already been scoped by the server. Mapping the column would invite a client-side
 * check of something the database has already decided, which is the one thing this
 * repository does not do.
 */
const ConsentTextVersionRowSchema = z.object({
  id: z.string(),
  version_label: z.string(),
  language: z.string(),
  full_text: z.string(),
  hash: z.string(),
  effective_from: z.string(),
  effective_until: z.string().nullable(),
  created_at: z.string(),
});

export const fromConsentTextVersionRow = (row: unknown): ConsentTextVersion => {
  const parsed = ConsentTextVersionRowSchema.parse(row);
  return ConsentTextVersionSchema.parse({
    id: parsed.id,
    versionLabel: parsed.version_label,
    language: parsed.language,
    fullText: parsed.full_text,
    hash: parsed.hash,
    effectiveFrom: parsed.effective_from,
    effectiveUntil: parsed.effective_until,
    createdAt: parsed.created_at,
  });
};

/**
 * A consent notice as the PULL sends it: the row, plus the server's precedence — MR-27 B1.
 *
 * **Separate from `ConsentTextVersion` on purpose.** `precedence` exists only on the pull
 * path, computed by `public.consent_text_version_precedence`. The REST endpoints and the
 * mock produce notices without it, and widening the shared type would make the field
 * optional — at which point a caller could silently fall back to re-deriving the order,
 * which is the whole thing this removes. A distinct type means the compiler asks.
 *
 * **What the number means.** 1 is the version the server would choose for that language
 * were it in force; 2 is the next; and so on, over `effective_from desc, created_at desc,
 * id desc`. It is NOT "is active" — see the migration header. Activeness depends on
 * `now()`, a pull is a snapshot, and a notice that becomes active because the clock passed
 * `effective_from` never changes and so is never re-emitted. The ordering carries no clock,
 * so it travels safely; the time window is applied wherever the question is asked.
 */
export const PulledConsentTextVersionSchema = ConsentTextVersionSchema.extend({
  precedence: z.number().int().positive(),
});
export type PulledConsentTextVersion = z.infer<typeof PulledConsentTextVersionSchema>;

const PulledConsentTextVersionRowSchema = ConsentTextVersionRowSchema.extend({
  precedence: z.number().int().positive(),
});

export const fromPulledConsentTextVersionRow = (row: unknown): PulledConsentTextVersion => {
  const parsed = PulledConsentTextVersionRowSchema.parse(row);
  return PulledConsentTextVersionSchema.parse({
    id: parsed.id,
    versionLabel: parsed.version_label,
    language: parsed.language,
    fullText: parsed.full_text,
    hash: parsed.hash,
    effectiveFrom: parsed.effective_from,
    effectiveUntil: parsed.effective_until,
    createdAt: parsed.created_at,
    precedence: parsed.precedence,
  });
};

export const fromClinicAddressRow = (row: unknown): ClinicAddress => {
  const parsed = ClinicAddressRowSchema.parse(row);
  return ClinicAddressSchema.parse({
    id: parsed.id,
    doctorId: parsed.doctor_id,
    label: parsed.label,
    line1: parsed.line1,
    line2: parsed.line2,
    city: parsed.city,
    state: parsed.state,
    postalCode: parsed.postal_code,
    // Null, always. See the note above: the pair exists in the table and the provenance
    // the contract demands does not, and inventing it is worse than omitting it.
    coordinates: null,
    geofenceRadiusMetres: parsed.geofence_radius_metres,
  });
};

export const BeatPlanRowSchema = z.object({
  id: UuidSchema,
  mr_id: UuidSchema,
  territory_id: UuidSchema,
  plan_date: IsoDateSchema,
  status: BeatPlanStatusSchema,
  approved_by_user_id: UuidSchema.nullable(),
  approved_at: IsoDateTimeSchema.nullable(),
  version: z.number().int().positive(),
  supersedes_beat_plan_id: UuidSchema.nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type BeatPlanRow = z.infer<typeof BeatPlanRowSchema>;

/** `BeatPlan` minus the entries a row cannot carry. */
export const BeatPlanRecordSchema = BeatPlanSchema.omit({ entries: true });
export type BeatPlanRecord = z.infer<typeof BeatPlanRecordSchema>;

export const fromBeatPlanRow = (row: unknown): BeatPlanRecord => {
  const parsed = BeatPlanRowSchema.parse(row);
  return BeatPlanRecordSchema.parse({
    id: parsed.id,
    mrId: parsed.mr_id,
    territoryId: parsed.territory_id,
    planDate: parsed.plan_date,
    status: parsed['status'],
    approvedByUserId: parsed.approved_by_user_id,
    approvedAt: parsed.approved_at,
    version: parsed.version,
    supersedesBeatPlanId: parsed.supersedes_beat_plan_id,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
};

/**
 * A type alias rather than an interface, deliberately: TypeScript gives type aliases an
 * implicit index signature and interfaces none, so only this form is assignable to the
 * `Record<string, unknown>` a database client's `insert()` takes.
 */
export type CreateVisitBody = {
  id: string;
  doctor_id: string;
  beat_plan_id: string | null;
  clinic_address_id: string | null;
  scheduled_for: string | null;
};

export const toCreateVisitBody = (input: CreateVisitRequest): CreateVisitBody => ({
  id: input.id,
  doctor_id: input.doctorId,
  beat_plan_id: input.beatPlanId ?? null,
  clinic_address_id: input.clinicAddressId ?? null,
  scheduled_for: input.scheduledFor ?? null,
});

export const fromVisitRow = (row: unknown): Visit => {
  const parsed = VisitRowSchema.parse(row);
  return VisitSchema.parse({
    id: parsed.id,
    mrId: parsed.mr_id,
    doctorId: parsed.doctor_id,
    beatPlanId: parsed.beat_plan_id,
    clinicAddressId: parsed.clinic_address_id,
    status: parsed.status,
    notMetReason: parsed.not_met_reason,
    scheduledFor: parsed.scheduled_for,
    startedAt: parsed.started_at,
    completedAt: parsed.completed_at,
    receivedAt: parsed.received_at,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  });
};

/**
 * A row from `daily_mileage(p_from, p_to, p_mr_id)`.
 *
 * The contract declares this surface as `GET /mileage`, which has no backend at all --
 * there is no `mileage` table or view. FIX-03 registered that as `BE-W52`; this is the
 * client half of it. `distance_metres` is summed server-side from stored coordinates
 * ordered by `occurred_at`, because a client-reported distance is an expense claim the
 * claimant wrote for themselves.
 */
export const MileageRowSchema = z.object({
  mr_id: UuidSchema,
  travel_date: IsoDateSchema,
  check_in_count: z.number().int().nonnegative(),
  distance_metres: z.number().nonnegative(),
});
export type MileageRow = z.infer<typeof MileageRowSchema>;

export const fromMileageRow = (row: unknown): MileageDay => {
  const parsed = MileageRowSchema.parse(row);
  return MileageDaySchema.parse({
    mrId: parsed.mr_id,
    travelDate: parsed.travel_date,
    checkInCount: parsed.check_in_count,
    distanceMetres: parsed.distance_metres,
  });
};

export const CheckOutRowSchema = CheckInRowSchema.extend({
  duration_seconds: z.number().int().nullable(),
});
export type CheckOutRow = z.infer<typeof CheckOutRowSchema>;

export const fromCheckOutRow = (row: unknown): CheckOut => {
  const parsed = CheckOutRowSchema.parse(row);
  return CheckOutSchema.parse({
    id: parsed.id,
    visitId: parsed.visit_id,
    mrId: parsed.mr_id,
    coordinates: {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracyMetres: parsed.accuracy_metres,
      // The row has no separate column: `occurred_at` IS when the device took the fix.
      capturedAt: parsed.occurred_at,
    },
    geofenceStatus: parsed.geofence_status,
    distanceFromClinicMetres: parsed.distance_from_clinic_metres,
    source: parsed.source,
    occurredAt: parsed.occurred_at,
    receivedAt: parsed.received_at,
    durationSeconds: parsed.duration_seconds,
    createdAt: parsed.created_at,
  });
};
