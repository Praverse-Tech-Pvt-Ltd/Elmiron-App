import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  AnalysisOverrideSchema,
  AnalysisSchema,
  ApiErrorResponseSchema,
  ApiRequestError,
  BeatPlanSchema,
  CallReportApprovalSchema,
  CallReportSchema,
  CheckInSchema,
  CheckOutSchema,
  ConsentRecordSchema,
  ConsentTextVersionSchema,
  DoctorSchema,
  GetMeResponseSchema,
  GetShiftWindowResponseSchema,
  SyncQueueStatusResponseSchema,
  ListAnalysesResponseSchema,
  ListBeatPlansResponseSchema,
  ListCallReportsResponseSchema,
  ListConsentRecordsResponseSchema,
  ListConsentTextVersionsResponseSchema,
  ListDoctorsResponseSchema,
  ListMileageResponseSchema,
  ListSamplesAndInputsResponseSchema,
  ListTerritoriesResponseSchema,
  ListVisitsResponseSchema,
  RecordingSchema,
  SampleAndInputSchema,
  SyncPullResponseSchema,
  SyncPushResponseSchema,
  SyncQueueItemSchema,
  TranscriptSchema,
  UploadSessionSchema,
  VisitSchema,
  VoiceNoteSchema,
  createApiClient,
  pageResponseSchema,
} from '@elmiron/core';
import { startMockServer } from '../src/server.js';
import { IDS } from '../src/fixtures.js';

/**
 * The mock is only a contract if something checks it against the contract.
 *
 * Every route below is fetched for real and parsed with the schema from
 * `@elmiron/core`. A fixture that drifts from the published types fails here, in
 * CI, rather than in a frontend screen three weeks later.
 */

let baseUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const started = await startMockServer(0);
  baseUrl = started.url;
  close = started.close;
});

afterAll(async () => {
  await close();
});

const call = async (
  path: string,
  options: { method?: string; body?: unknown; scenario?: string } = {},
): Promise<{ status: number; body: unknown }> => {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.scenario !== undefined) headers['x-mock-scenario'] = options.scenario;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json() };
};

const expectConforms = async (
  path: string,
  schema: ZodType,
  options: { method?: string; body?: unknown; expectStatus?: number } = {},
): Promise<void> => {
  const { status, body } = await call(path, options);
  expect(status, `${options.method ?? 'GET'} ${path} status`).toBe(options.expectStatus ?? 200);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} does not conform to its schema:\n` +
        JSON.stringify(parsed.error.issues, null, 2),
    );
  }
};

// -----------------------------------------------------------------------------

describe('every declared endpoint conforms to packages/core', () => {
  it('GET /me', async () => {
    await expectConforms('/me', GetMeResponseSchema);
  });

  it('GET /territories', async () => {
    await expectConforms('/territories', ListTerritoriesResponseSchema);
  });

  it('GET /doctors and GET /doctors/:id', async () => {
    await expectConforms('/doctors', ListDoctorsResponseSchema);
    await expectConforms(`/doctors/${IDS.doctorA}`, DoctorSchema);
  });

  it('GET /beat-plans and GET /beat-plans/:id', async () => {
    await expectConforms('/beat-plans', ListBeatPlansResponseSchema);
    await expectConforms(`/beat-plans/${IDS.beatPlan}`, BeatPlanSchema);
  });

  it('visits — list, create, read, update', async () => {
    await expectConforms('/visits', ListVisitsResponseSchema);
    await expectConforms('/visits', VisitSchema, {
      method: 'POST',
      body: { id: IDS.visitInProgress, doctorId: IDS.doctorA },
      expectStatus: 201,
    });
    await expectConforms(`/visits/${IDS.visitDone}`, VisitSchema);
    await expectConforms(`/visits/${IDS.visitDone}`, VisitSchema, { method: 'PATCH', body: {} });
  });

  it('check-ins and check-outs are readable, and written through the RPC', async () => {
    await expectConforms('/check-ins', pageResponseSchema(CheckInSchema));
    await expectConforms('/check-outs', pageResponseSchema(CheckOutSchema));
    await expectConforms('/rpc/record_check_in', CheckInSchema, {
      method: 'POST',
      body: {
        p_id: IDS.checkIn,
        p_visit_id: IDS.visitDone,
        p_latitude: 18.5075,
        p_longitude: 73.8079,
        p_occurred_at: '2026-08-10T10:04:00+05:30',
      },
      expectStatus: 201,
    });
    await expectConforms('/rpc/record_check_out', CheckOutSchema, {
      method: 'POST',
      body: {
        p_id: IDS.checkOut,
        p_visit_id: IDS.visitDone,
        p_latitude: 18.5076,
        p_longitude: 73.808,
        p_occurred_at: '2026-08-10T10:21:00+05:30',
      },
      expectStatus: 201,
    });
  });

  it('refuses a direct write to a capture table, as the real API does', async () => {
    // This is the assertion that stops the mock drifting back into a fiction. If
    // someone re-adds a happy-path POST /check-ins, this fails in CI rather than at
    // integration in week 11.
    for (const path of ['/check-ins', '/check-outs']) {
      const { status, body } = await call(path, { method: 'POST', body: { id: IDS.checkIn } });
      expect(status, `${path} must refuse a direct write`).toBe(403);
      const parsed = ApiErrorResponseSchema.parse(body);
      expect(parsed.error.code).toBe('permission_denied');
      expect(parsed.error.message).toMatch(/record_check_(in|out)/);
    }
  });

  it('call reports, approval and samples', async () => {
    await expectConforms('/call-reports', ListCallReportsResponseSchema);
    await expectConforms('/call-reports', CallReportSchema, {
      method: 'POST',
      body: { id: IDS.callReport },
      expectStatus: 201,
    });
    await expectConforms(`/call-reports/${IDS.callReport}/approval`, CallReportApprovalSchema, {
      method: 'POST',
      body: { approved: true },
      expectStatus: 201,
    });
    await expectConforms('/samples-and-inputs', ListSamplesAndInputsResponseSchema);
    await expectConforms('/samples-and-inputs', SampleAndInputSchema, {
      method: 'POST',
      body: { id: IDS.sample },
      expectStatus: 201,
    });
  });

  it('shift window and mileage', async () => {
    await expectConforms('/shift-window', GetShiftWindowResponseSchema);
    await expectConforms('/rpc/my_shift_window', GetShiftWindowResponseSchema);
    await expectConforms('/rpc/sync_queue_status', SyncQueueStatusResponseSchema);
    await expectConforms(
      '/mileage?fromDate=2026-08-01&toDate=2026-08-10',
      ListMileageResponseSchema,
    );
  });

  it('consent — text versions, active text, records, withdrawal', async () => {
    await expectConforms('/consent-text-versions', ListConsentTextVersionsResponseSchema);
    await expectConforms('/consent-text-versions/active?language=hi-IN', ConsentTextVersionSchema);
    await expectConforms('/consent-records', ListConsentRecordsResponseSchema);
    await expectConforms('/consent-records/withdrawals', ConsentRecordSchema, {
      method: 'POST',
      body: { id: IDS.consentWithdrawal, supersedesConsentRecordId: IDS.consentGranted },
      expectStatus: 201,
    });
  });

  it('capture — voice notes, recordings, resumable upload, transcript', async () => {
    await expectConforms('/voice-notes', pageResponseSchema(VoiceNoteSchema));
    await expectConforms('/voice-notes', UploadSessionSchema, {
      method: 'POST',
      body: { id: IDS.voiceNote },
      expectStatus: 201,
    });
    await expectConforms('/recordings', pageResponseSchema(RecordingSchema));
    await expectConforms('/recordings', UploadSessionSchema, {
      method: 'POST',
      body: { id: IDS.recording },
      expectStatus: 201,
    });
    await expectConforms(`/uploads/${IDS.uploadSession}`, UploadSessionSchema);
    await expectConforms('/uploads/completion', RecordingSchema, { method: 'POST', body: {} });
    await expectConforms(`/transcripts/${IDS.transcript}`, TranscriptSchema);
  });

  it('analyses — list, read, respond, override', async () => {
    await expectConforms('/analyses', ListAnalysesResponseSchema);
    await expectConforms(`/analyses/${IDS.analysis}`, AnalysisSchema);
    await expectConforms(`/analyses/${IDS.analysis}/response`, AnalysisSchema, {
      method: 'POST',
      body: { response: 'The doctor asked me to send it by message.' },
    });
    await expectConforms(`/analyses/${IDS.analysis}/overrides`, AnalysisOverrideSchema, {
      method: 'POST',
      body: { findingId: IDS.finding, reason: 'Context the model could not see.' },
      expectStatus: 201,
    });
  });

  it('offline sync — push, pull, queue inspection', async () => {
    await expectConforms('/rpc/sync_push', SyncPushResponseSchema, {
      method: 'POST',
      body: {
        batchId: IDS.queuedVisit,
        items: [
          {
            id: IDS.queuedVisit,
            entity: 'visit',
            operation: 'create',
            entityId: IDS.visitInProgress,
            payload: {},
            clientCreatedAt: '2026-08-10T15:02:00+05:30',
          },
        ],
      },
    });
    await expectConforms('/sync/pull', SyncPullResponseSchema, { method: 'POST', body: {} });
    await expectConforms('/sync/queue', pageResponseSchema(SyncQueueItemSchema));
  });
});

// -----------------------------------------------------------------------------

describe('list states', () => {
  it('populated by default', async () => {
    const { body } = await call('/visits');
    expect(ListVisitsResponseSchema.parse(body).items.length).toBeGreaterThan(1);
  });

  it('single', async () => {
    const { body } = await call('/visits', { scenario: 'single' });
    expect(ListVisitsResponseSchema.parse(body).items).toHaveLength(1);
  });

  it('empty, with hasMore false and a null cursor', async () => {
    const { body } = await call('/visits', { scenario: 'empty' });
    const page = ListVisitsResponseSchema.parse(body);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('paginates for real — a cursor walks the whole list without repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query: string = cursor === null ? '?limit=1' : `?limit=1&cursor=${cursor}`;
      const { body } = await call(`/visits${query}`);
      const page = ListVisitsResponseSchema.parse(body);
      seen.push(...page.items.map((visit) => visit.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(1);
  });
});

describe('failure states', () => {
  it('permission denied is a denial, not an empty list', async () => {
    const { status, body } = await call('/visits', { scenario: 'denied' });
    expect(status).toBe(403);
    expect(ApiErrorResponseSchema.parse(body).error.code).toBe('permission_denied');
  });

  it.each([
    ['unauthenticated', 401, 'unauthenticated'],
    ['validation', 422, 'validation_failed'],
    ['conflict', 409, 'conflict'],
    ['rate-limited', 429, 'rate_limited'],
    ['error', 500, 'internal_error'],
  ])('%s returns %i', async (scenario, status, code) => {
    const response = await call('/visits', { scenario });
    expect(response.status).toBe(status);
    expect(ApiErrorResponseSchema.parse(response.body).error.code).toBe(code);
  });

  it('validation failures carry field errors', async () => {
    const { body } = await call('/call-reports', {
      scenario: 'validation',
      method: 'POST',
      body: {},
    });
    expect(ApiErrorResponseSchema.parse(body).error.fieldErrors).not.toBeNull();
  });

  it('an unknown route is a 404 in the documented error envelope', async () => {
    const { status, body } = await call('/nope');
    expect(status).toBe(404);
    expect(ApiErrorResponseSchema.parse(body).error.code).toBe('not_found');
  });
});

describe('working hours', () => {
  it('reports a resolved window and the territory it came from', async () => {
    const { body } = await call('/shift-window');
    const parsed = GetShiftWindowResponseSchema.parse(body);
    expect(parsed.window?.timezone).toBe('Asia/Kolkata');
    expect(parsed.resolvedFromTerritoryId).not.toBeNull();
  });

  it('reports a null window rather than a 404 when none is configured', async () => {
    // "Not configured" is a state the app must render, not a transient failure it
    // should retry. A 404 here would read as the latter.
    const { status, body } = await call('/shift-window', { scenario: 'empty' });
    expect(status).toBe(200);
    expect(GetShiftWindowResponseSchema.parse(body).window).toBeNull();
  });

  it('mileage totals match the sum of the days', async () => {
    const { body } = await call('/mileage?fromDate=2026-08-01&toDate=2026-08-10');
    const parsed = ListMileageResponseSchema.parse(body);
    const summed = parsed.days.reduce((total, day) => total + day.distanceMetres, 0);
    expect(parsed.totalDistanceMetres).toBeCloseTo(summed, 3);
  });

  it('includes a zero-distance day, because one check-in is a normal day', async () => {
    const { body } = await call('/mileage?fromDate=2026-08-01&toDate=2026-08-10');
    const parsed = ListMileageResponseSchema.parse(body);
    expect(parsed.days.some((day) => day.distanceMetres === 0)).toBe(true);
  });
});

describe('the offline-sync scenario', () => {
  it('returns a queue covering queued, in-flight, conflict and failed', async () => {
    const { body } = await call('/sync/queue');
    const page = pageResponseSchema(SyncQueueItemSchema).parse(body);
    const statuses = page.items.map((item) => item.status);
    expect(statuses).toContain('queued');
    expect(statuses).toContain('in_flight');
    expect(statuses).toContain('conflict');
    expect(statuses).toContain('failed');
  });

  it('push returns a mix of accepted, duplicate, rejected and dead-lettered', async () => {
    const { body } = await call('/rpc/sync_push', {
      method: 'POST',
      body: {
        batchId: IDS.queuedVisit,
        items: Array.from({ length: 5 }, (_unused, index) => ({
          id: `1515151${String(index)}-1515-4515-8515-151515151501`,
          entity: 'visit',
          operation: 'create',
          entityId: IDS.visitInProgress,
          payload: {},
          clientCreatedAt: '2026-08-10T15:02:00+05:30',
        })),
      },
    });
    const parsed = SyncPushResponseSchema.parse(body);
    expect(parsed.results.map((r) => r.status)).toEqual([
      'accepted',
      'duplicate',
      'rejected',
      'accepted',
      'dead_lettered',
    ]);
    // A rejection always carries a machine-readable code; an acceptance may carry a
    // warning. Frontend renders both differently, so both must be exercised.
    expect(parsed.results[2]?.rejectionCode).toBe('outside_shift_window');
    expect(parsed.results[3]?.warnings).toContain('stale_beat_plan');
  });
});

describe('the published API client works against the mock', () => {
  it('reads and writes through createApiClient', async () => {
    const client = createApiClient({ baseUrl, getAccessToken: () => 'mock-token' });

    const me = await client.getMe();
    expect(me.profile.role).toBe('mr');

    const visits = await client.listVisits({ limit: 2 });
    expect(visits.items.length).toBeGreaterThan(0);

    // All three consent outcomes succeed. Declining is not an error path.
    for (const outcome of ['consented', 'declined', 'not_asked'] as const) {
      const record = await client.createConsentRecord({
        id: IDS.consentGranted,
        visitId: IDS.visitDone,
        doctorId: IDS.doctorA,
        outcome,
        notAskedReason: outcome === 'not_asked' ? 'Doctor was called away.' : null,
        consentTextVersionId: IDS.consentTextEn,
        displayedLanguage: 'en-IN',
        capturedAt: '2026-08-10T10:05:00+05:30',
      });
      expect(record.id).toBe(IDS.consentGranted);
    }
  });

  it('surfaces permission_denied as a thrown ApiRequestError, never as empty data', async () => {
    const client = createApiClient({
      baseUrl,
      getAccessToken: () => 'mock-token',
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), 'x-mock-scenario': 'denied' },
        }),
    });

    await expect(client.listVisits()).rejects.toBeInstanceOf(ApiRequestError);
    await expect(client.listVisits()).rejects.toMatchObject({ code: 'permission_denied' });
  });
});
