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
  CallReportSchema,
  CaptureSourceSchema,
  CheckInSchema,
  CheckOutSchema,
  DoctorSchema,
  MileageDaySchema,
  SampleAndInputSchema,
  SampleOrInputKindSchema,
  TerritoryShiftWindowSchema,
  VisitSchema,
} from './entities.js';
import { ConsentOutcomeSchema, ConsentRecordSchema, ConsentTextVersionSchema } from './consent.js';
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

export const SyncPullRequestSchema = z.object({
  /** Omit for a full initial pull. */
  since: IsoDateTimeSchema.nullish(),
  entities: z.array(SyncEntitySchema).nullish(),
});
export type SyncPullRequest = z.infer<typeof SyncPullRequestSchema>;

export const SyncPullResponseSchema = z.object({
  changes: z.array(
    z.object({
      entity: SyncEntitySchema,
      entityId: UuidSchema,
      deleted: z.boolean(),
      payload: z.record(z.string(), z.unknown()).nullable(),
      updatedAt: IsoDateTimeSchema,
    }),
  ),
  serverTime: IsoDateTimeSchema,
  hasMore: z.boolean(),
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
