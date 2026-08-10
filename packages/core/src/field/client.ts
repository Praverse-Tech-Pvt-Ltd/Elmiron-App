import type { ZodType } from 'zod';
import { ApiErrorResponseSchema, ApiRequestError } from '../shared/errors.js';
import type { ApiError } from '../shared/errors.js';
import {
  API_PATHS,
  CreateCallReportRequestSchema,
  CreateCheckInRequestSchema,
  CreateCheckOutRequestSchema,
  CreateConsentRecordRequestSchema,
  CreateVisitRequestSchema,
  GetMeResponseSchema,
  ListAnalysesResponseSchema,
  ListCallReportsResponseSchema,
  ListConsentRecordsResponseSchema,
  ListDoctorsResponseSchema,
  ListTerritoriesResponseSchema,
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
  CreateVisitRequest,
  GetMeResponse,
  ListAnalysesRequest,
  ListAnalysesResponse,
  ListCallReportsRequest,
  ListCallReportsResponse,
  ListConsentRecordsRequest,
  ListConsentRecordsResponse,
  ListDoctorsRequest,
  ListDoctorsResponse,
  ListTerritoriesResponse,
  ListVisitsRequest,
  ListVisitsResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  WithdrawConsentRequest,
} from './endpoints.js';
import { CallReportSchema, CheckInSchema, CheckOutSchema, VisitSchema } from './entities.js';
import type { CallReport, CheckIn, CheckOut, Visit } from './entities.js';
import { ConsentRecordSchema } from './consent.js';
import type { ConsentRecord } from './consent.js';

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

    listVisits: (params: Partial<ListVisitsRequest> = {}): Promise<ListVisitsResponse> =>
      request(
        'GET',
        `${API_PATHS.visits}${toQueryString(params as Record<string, QueryValue>)}`,
        ListVisitsResponseSchema,
      ),

    createVisit: (input: CreateVisitRequest): Promise<Visit> =>
      request('POST', API_PATHS.visits, VisitSchema, CreateVisitRequestSchema.parse(input)),

    createCheckIn: (input: CreateCheckInRequest): Promise<CheckIn> =>
      request('POST', API_PATHS.checkIns, CheckInSchema, CreateCheckInRequestSchema.parse(input)),

    createCheckOut: (input: CreateCheckOutRequest): Promise<CheckOut> =>
      request(
        'POST',
        API_PATHS.checkOuts,
        CheckOutSchema,
        CreateCheckOutRequestSchema.parse(input),
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
