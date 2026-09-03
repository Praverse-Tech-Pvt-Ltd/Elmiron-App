import type { ZodType } from 'zod';
import { ApiErrorResponseSchema, ApiRequestError } from '../shared/errors.js';
import type { ApiError } from '../shared/errors.js';
import {
  API_PATHS,
  CreateCallReportRequestSchema,
  CreateCheckInRequestSchema,
  CreateCheckOutRequestSchema,
  CreateConsentRecordRequestSchema,
  CreateSampleAndInputRequestSchema,
  CreateVisitRequestSchema,
  GetMeResponseSchema,
  ListAnalysesResponseSchema,
  ListCallReportsResponseSchema,
  ListConsentRecordsResponseSchema,
  ListConsentTextVersionsResponseSchema,
  ListDoctorsResponseSchema,
  ListTerritoriesResponseSchema,
  ListBeatPlansResponseSchema,
  ListMileageResponseSchema,
  ListSamplesAndInputsResponseSchema,
  toRecordCheckInBody,
  ListVisitsResponseSchema,
  SyncPullRequestSchema,
  SyncPullResponseSchema,
  SyncPushRequestSchema,
  SyncPushResponseSchema,
  WithdrawConsentRequestSchema,
} from './endpoints.js';
import type {
  CreateCallReportRequest,
  CreateCheckInRequest,
  CreateCheckOutRequest,
  CreateConsentRecordRequest,
  CreateSampleAndInputRequest,
  CreateVisitRequest,
  GetMeResponse,
  ListAnalysesRequest,
  ListAnalysesResponse,
  ListCallReportsRequest,
  ListCallReportsResponse,
  GetActiveConsentTextRequest,
  ListConsentRecordsRequest,
  ListConsentRecordsResponse,
  ListConsentTextVersionsResponse,
  ListDoctorsRequest,
  ListDoctorsResponse,
  ListTerritoriesResponse,
  ListBeatPlansRequest,
  ListBeatPlansResponse,
  ListMileageRequest,
  ListMileageResponse,
  ListSamplesAndInputsResponse,
  ListVisitsRequest,
  ListVisitsResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  WithdrawConsentRequest,
} from './endpoints.js';
import {
  CallReportSchema,
  CheckInSchema,
  CheckOutSchema,
  SampleAndInputSchema,
  VisitSchema,
} from './entities.js';
import type { CallReport, CheckIn, CheckOut, SampleAndInput, Visit } from './entities.js';
import { ConsentRecordSchema, ConsentTextVersionSchema } from './consent.js';
import type { ConsentRecord, ConsentTextVersion } from './consent.js';

export interface ApiClientOptions {
  /** Base URL of the API, e.g. `http://localhost:54321/functions/v1`. No trailing slash. */
  baseUrl: string;
  /** Returns the current Supabase access token, or `null` when signed out. */
  getAccessToken: () => string | null | Promise<string | null>;
  /** Injectable for tests and for the mock server. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

type QueryValue = string | number | boolean | null | undefined;

const toQueryString = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
};

/**
 * A thin typed wrapper over `fetch`.
 *
 * Two deliberate properties:
 * - Every response is parsed against its schema. A server that drifts from the
 *   contract fails loudly here rather than surfacing as a rendering bug.
 * - A non-2xx response throws `ApiRequestError` carrying the code. In particular
 *   `permission_denied` reaches the caller as a denial, never as empty data.
 */
export const createApiClient = (options: ApiClientOptions) => {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  const request = async <T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    schema: ZodType<T>,
    body?: unknown,
  ): Promise<T> => {
    const token = await options.getAccessToken();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const payload: unknown = response.status === 204 ? null : await response.json();

    if (!response.ok) {
      const parsed = ApiErrorResponseSchema.safeParse(payload);
      const error: ApiError = parsed.success
        ? parsed.data.error
        : {
            code: 'internal_error',
            message: `Unexpected error response (HTTP ${String(response.status)})`,
            requestId: response.headers.get('x-request-id') ?? '',
            fieldErrors: null,
          };
      throw new ApiRequestError(response.status, error);
    }

    return schema.parse(payload);
  };

  return {
    getMe: (): Promise<GetMeResponse> => request('GET', API_PATHS.me, GetMeResponseSchema),

    listTerritories: (): Promise<ListTerritoriesResponse> =>
      request('GET', API_PATHS.territories, ListTerritoriesResponseSchema),

    listDoctors: (params: Partial<ListDoctorsRequest> = {}): Promise<ListDoctorsResponse> =>
      request(
        'GET',
        `${API_PATHS.doctors}${toQueryString(params as Record<string, QueryValue>)}`,
        ListDoctorsResponseSchema,
      ),

    /**
     * The plan the server approved, with its entries in `plannedSequence` order.
     *
     * Read-only here on purpose. `BeatPlan` carries `version` and
     * `supersedesBeatPlanId`, which say that a changed plan is a NEW row rather
     * than an edit of the old one — reordering or amending a plan is the server's
     * operation, and there is no client method for it because the client is not
     * the thing that decides what an MR's day is.
     */
    listBeatPlans: (params: Partial<ListBeatPlansRequest> = {}): Promise<ListBeatPlansResponse> =>
      request(
        'GET',
        `${API_PATHS.beatPlans}${toQueryString(params as Record<string, QueryValue>)}`,
        ListBeatPlansResponseSchema,
      ),

    /**
     * The server's own mileage, per day.
     *
     * Read-only, and there is deliberately no client-side distance calculation to
     * pair with it. `daily_mileage()` derives this from the check-in fixes the
     * server holds; a distance computed on the device would be, in the contract's
     * own words about `distanceFromClinicMetres`, "an expense claim it wrote
     * itself".
     */
    listMileage: (params: ListMileageRequest): Promise<ListMileageResponse> =>
      request(
        'GET',
        `${API_PATHS.mileage}${toQueryString(params as unknown as Record<string, QueryValue>)}`,
        ListMileageResponseSchema,
      ),

    listVisits: (params: Partial<ListVisitsRequest> = {}): Promise<ListVisitsResponse> =>
      request(
        'GET',
        `${API_PATHS.visits}${toQueryString(params as Record<string, QueryValue>)}`,
        ListVisitsResponseSchema,
      ),

    createVisit: (input: CreateVisitRequest): Promise<Visit> =>
      request('POST', API_PATHS.visits, VisitSchema, CreateVisitRequestSchema.parse(input)),

    /**
     * Check-in goes through the RPC, never through `POST /check-ins`.
     *
     * The server refuses the direct write in as many words — "Direct writes to
     * /check-ins are not permitted. Call record_check_in instead — work-hours,
     * geofence and duration are enforced there." Posting to the REST path returned
     * `permission_denied` every time, which is the server protecting rules the
     * client must not be able to skip.
     *
     * `toRecordCheckInBody` already existed in the contract for this conversion,
     * which is the strongest evidence the RPC was always the intended path and the
     * REST call was the mistake.
     */
    createCheckIn: (input: CreateCheckInRequest): Promise<CheckIn> =>
      request(
        'POST',
        API_PATHS.recordCheckIn,
        CheckInSchema,
        toRecordCheckInBody(CreateCheckInRequestSchema.parse(input)),
      ),

    createCheckOut: (input: CreateCheckOutRequest): Promise<CheckOut> =>
      request(
        'POST',
        API_PATHS.recordCheckOut,
        CheckOutSchema,
        toRecordCheckInBody(CreateCheckOutRequestSchema.parse(input)),
      ),

    listCallReports: (
      params: Partial<ListCallReportsRequest> = {},
    ): Promise<ListCallReportsResponse> =>
      request(
        'GET',
        `${API_PATHS.callReports}${toQueryString(params as Record<string, QueryValue>)}`,
        ListCallReportsResponseSchema,
      ),

    createCallReport: (input: CreateCallReportRequest): Promise<CallReport> =>
      request(
        'POST',
        API_PATHS.callReports,
        CallReportSchema,
        CreateCallReportRequestSchema.parse(input),
      ),

    /**
     * What an MR handed over at a visit — Phase 2 C5.
     *
     * **Insert only, and there is no update or delete to pair with it.**
     * `samples_and_inputs` grants `select, insert` to `authenticated` and nothing
     * else, and every row is mirrored into the audit log by trigger. A correction
     * is a new row, not an edit — which is the same append-only rule consent
     * records follow, and for the same reason: this is the evidence that a
     * transfer of value happened.
     *
     * `id` is device-generated so a retry from a doorway with one bar is one
     * handover rather than two.
     */
    createSampleAndInput: (input: CreateSampleAndInputRequest): Promise<SampleAndInput> =>
      request(
        'POST',
        API_PATHS.samplesAndInputs,
        SampleAndInputSchema,
        CreateSampleAndInputRequestSchema.parse(input),
      ),

    /**
     * Everything the caller may see under `samples_and_inputs_select_own_or_team`.
     *
     * There is deliberately no cap parameter and no cap in the response. The
     * UCPMP monthly limit exists in no column, no constraint and no function in
     * the schema today, so a client that asked for it would be asking for
     * something nobody computes — see `SamplesScreen` for what is shown instead.
     */
    listSamplesAndInputs: (
      params: Record<string, QueryValue> = {},
    ): Promise<ListSamplesAndInputsResponse> =>
      request(
        'GET',
        `${API_PATHS.samplesAndInputs}${toQueryString(params)}`,
        ListSamplesAndInputsResponseSchema,
      ),

    /**
     * The notice that is in force for a language, right now — Phase 3.
     *
     * **Nothing may be shown to a doctor without this call succeeding.** A consent
     * record carries `consentTextVersionId` and `displayedLanguage` so that what
     * was agreed to can be reconstructed afterwards; a screen that showed
     * app-authored copy and then pointed the record at some other version would
     * make the ledger attest to text the doctor never saw. So the notice is
     * fetched, shown verbatim, and its id is what the record carries.
     *
     * The version is **not** cached across visits here. `effectiveUntil` exists on
     * the entity, which means a version can stop being current between one visit
     * and the next, and a stale id in a consent row is exactly the defect the
     * hash on `ConsentTextVersion` exists to detect.
     */
    getActiveConsentText: (params: GetActiveConsentTextRequest): Promise<ConsentTextVersion> =>
      request(
        'GET',
        `${API_PATHS.consentTextActive}${toQueryString(params as unknown as Record<string, QueryValue>)}`,
        ConsentTextVersionSchema,
      ),

    /**
     * Every notice version the caller may see, current and past.
     *
     * Used for one thing on the device: discovering **which languages a notice
     * actually exists in**, so the MR is offered those and no others. A language
     * picker built from a hard-coded list offers a doctor a language the server
     * cannot produce a notice in, and the handoff then dead-ends in front of them.
     */
    listConsentTextVersions: (
      params: Record<string, QueryValue> = {},
    ): Promise<ListConsentTextVersionsResponse> =>
      request(
        'GET',
        `${API_PATHS.consentTextVersions}${toQueryString(params)}`,
        ListConsentTextVersionsResponseSchema,
      ),

    /** All three outcomes use this call and all three succeed. */
    createConsentRecord: (input: CreateConsentRecordRequest): Promise<ConsentRecord> =>
      request(
        'POST',
        API_PATHS.consentRecords,
        ConsentRecordSchema,
        CreateConsentRecordRequestSchema.parse(input),
      ),

    /** Creates a new row. Never mutates the record being withdrawn. */
    withdrawConsent: (input: WithdrawConsentRequest): Promise<ConsentRecord> =>
      request(
        'POST',
        API_PATHS.consentWithdrawals,
        ConsentRecordSchema,
        WithdrawConsentRequestSchema.parse(input),
      ),

    listConsentRecords: (
      params: Partial<ListConsentRecordsRequest> = {},
    ): Promise<ListConsentRecordsResponse> =>
      request(
        'GET',
        `${API_PATHS.consentRecords}${toQueryString(params as Record<string, QueryValue>)}`,
        ListConsentRecordsResponseSchema,
      ),

    listAnalyses: (params: Partial<ListAnalysesRequest> = {}): Promise<ListAnalysesResponse> =>
      request(
        'GET',
        `${API_PATHS.analyses}${toQueryString(params as Record<string, QueryValue>)}`,
        ListAnalysesResponseSchema,
      ),

    syncPush: (input: SyncPushRequest): Promise<SyncPushResponse> =>
      request(
        'POST',
        API_PATHS.syncPush,
        SyncPushResponseSchema,
        SyncPushRequestSchema.parse(input),
      ),

    syncPull: (input: SyncPullRequest): Promise<SyncPullResponse> =>
      request(
        'POST',
        API_PATHS.syncPull,
        SyncPullResponseSchema,
        SyncPullRequestSchema.parse(input),
      ),
  };
};

export type ApiClient = ReturnType<typeof createApiClient>;
