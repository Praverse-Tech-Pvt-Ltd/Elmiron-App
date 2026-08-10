import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { API_PATHS } from '@elmiron/core';
import type { ApiError, ApiErrorCode } from '@elmiron/core';
import * as fx from './fixtures.js';

/**
 * Mock API server — interface contract I2.
 *
 * Frontend builds against this for twelve weeks, so it returns more than the happy
 * path. Every list endpoint can be driven into a populated, single-item or empty
 * state, every endpoint can be driven into each error the real API can produce, and
 * lists paginate for real.
 *
 * Scenario selection, in priority order:
 *   1. `x-mock-scenario` request header
 *   2. `_scenario` query parameter
 *   3. `populated`
 *
 * Scenarios:
 *   populated        default — realistic multi-item responses
 *   single           lists return exactly one item
 *   empty            lists return zero items, with hasMore false
 *   denied           403 permission_denied on every route
 *   unauthenticated  401
 *   validation       422 validation_failed with field errors
 *   conflict         409
 *   rate-limited     429
 *   error            500 internal_error
 *   offline-sync     sync endpoints return a full queued day; other routes normal
 *
 * `denied` returns permission_denied rather than an empty list on purpose. The
 * frontend must render a denial as a denial — if the API ever returns one, that is
 * a backend bug to report, never something to filter away in the client.
 */

export type Scenario =
  | 'populated'
  | 'single'
  | 'empty'
  | 'denied'
  | 'unauthenticated'
  | 'validation'
  | 'conflict'
  | 'rate-limited'
  | 'error'
  | 'offline-sync';

const ERROR_SCENARIOS: Record<string, { status: number; code: ApiErrorCode; message: string }> = {
  denied: {
    status: 403,
    code: 'permission_denied',
    message: 'This record belongs to another medical representative.',
  },
  unauthenticated: {
    status: 401,
    code: 'unauthenticated',
    message: 'The session has expired. Sign in again.',
  },
  validation: {
    status: 422,
    code: 'validation_failed',
    message: 'The request failed validation.',
  },
  conflict: {
    status: 409,
    code: 'conflict',
    message: 'This record was changed on the server since it was queued.',
  },
  'rate-limited': { status: 429, code: 'rate_limited', message: 'Too many requests. Retry later.' },
  error: { status: 500, code: 'internal_error', message: 'Something went wrong on the server.' },
};

interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  scenario: Scenario;
  params: Record<string, string>;
  body: unknown;
  requestId: string;
}

// --- pagination --------------------------------------------------------------

const DEFAULT_LIMIT = 50;

const paginate = <T>(
  items: T[],
  ctx: Ctx,
): { items: T[]; nextCursor: string | null; hasMore: boolean } => {
  const source =
    ctx.scenario === 'empty' ? [] : ctx.scenario === 'single' ? items.slice(0, 1) : items;

  const limitParam = Number(ctx.query.get('limit') ?? DEFAULT_LIMIT);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : DEFAULT_LIMIT;

  const cursorParam = ctx.query.get('cursor');
  const offset =
    cursorParam === null ? 0 : Number(Buffer.from(cursorParam, 'base64url').toString());
  const start = Number.isFinite(offset) && offset > 0 ? offset : 0;

  const page = source.slice(start, start + limit);
  const nextOffset = start + page.length;
  const hasMore = nextOffset < source.length;

  return {
    items: page,
    nextCursor: hasMore ? Buffer.from(String(nextOffset)).toString('base64url') : null,
    hasMore,
  };
};

// --- routing -----------------------------------------------------------------

type Handler = (ctx: Ctx) => { status?: number; body: unknown };

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
}

const matchPath = (pattern: string, path: string): Record<string, string> | null => {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index];
    if (actual === undefined) return null;
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(actual);
    } else if (part !== actual) {
      return null;
    }
  }
  return params;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** Narrow an unknown request field to a string, or fall back. Never stringifies an object. */
const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const withId = <T extends { id: string }>(entity: T, body: unknown): T => {
  const id = asRecord(body)['id'];
  return typeof id === 'string' ? { ...entity, id } : entity;
};

const first = <T>(items: T[]): T => {
  const item = items[0];
  if (item === undefined) throw new Error('fixture list is empty');
  return item;
};

const routes: Route[] = [
  // --- session -------------------------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.me,
    handler: () => ({
      body: {
        profile: fx.profile,
        visibleTerritoryIds: [fx.IDS.puneTerritory],
      },
    }),
  },
  {
    method: 'GET',
    pattern: API_PATHS.territories,
    handler: (ctx) => ({ body: paginate(fx.territories, ctx) }),
  },

  // --- doctors and beat plans ----------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.doctors,
    handler: (ctx) => {
      const territoryId = ctx.query.get('territoryId');
      const filtered =
        territoryId === null ? fx.doctors : fx.doctors.filter((d) => d.territoryId === territoryId);
      return { body: paginate(filtered, ctx) };
    },
  },
  {
    method: 'GET',
    pattern: '/doctors/:id',
    handler: (ctx) => {
      const doctor = fx.doctors.find((d) => d.id === ctx.params['id']);
      return doctor === undefined ? notFound('doctor') : { body: doctor };
    },
  },
  {
    method: 'GET',
    pattern: API_PATHS.beatPlans,
    handler: (ctx) => ({ body: paginate(fx.beatPlans, ctx) }),
  },
  {
    method: 'GET',
    pattern: '/beat-plans/:id',
    handler: (ctx) => {
      const plan = fx.beatPlans.find((p) => p.id === ctx.params['id']);
      return plan === undefined ? notFound('beat plan') : { body: plan };
    },
  },

  // --- visits ---------------------------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.visits,
    handler: (ctx) => ({ body: paginate(fx.visits, ctx) }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.visits,
    handler: (ctx) => ({ status: 201, body: withId(first(fx.visits), ctx.body) }),
  },
  {
    method: 'GET',
    pattern: '/visits/:id',
    handler: (ctx) => {
      const visit = fx.visits.find((v) => v.id === ctx.params['id']);
      return visit === undefined ? notFound('visit') : { body: visit };
    },
  },
  {
    method: 'PATCH',
    pattern: '/visits/:id',
    handler: (ctx) => ({
      body: { ...first(fx.visits), id: ctx.params['id'] ?? first(fx.visits).id },
    }),
  },
  {
    method: 'GET',
    pattern: API_PATHS.checkIns,
    handler: (ctx) => ({ body: paginate(fx.checkIns, ctx) }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.checkIns,
    handler: (ctx) => ({ status: 201, body: withId(first(fx.checkIns), ctx.body) }),
  },
  {
    method: 'GET',
    pattern: API_PATHS.checkOuts,
    handler: (ctx) => ({ body: paginate(fx.checkOuts, ctx) }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.checkOuts,
    handler: (ctx) => ({ status: 201, body: withId(first(fx.checkOuts), ctx.body) }),
  },

  // --- working hours and mileage --------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.shiftWindow,
    handler: (ctx) => ({
      body:
        ctx.scenario === 'empty'
          ? // No window configured anywhere. Capture is refused in this state, and
            // the app must say so rather than retry — hence a 200 with a null, not
            // a 404 that reads as a transient failure.
            { window: null, resolvedFromTerritoryId: null }
          : { window: fx.shiftWindow, resolvedFromTerritoryId: fx.IDS.orgTerritory },
    }),
  },
  {
    method: 'GET',
    pattern: API_PATHS.mileage,
    handler: (ctx) => {
      const days =
        ctx.scenario === 'empty'
          ? []
          : ctx.scenario === 'single'
            ? fx.mileageDays.slice(0, 1)
            : fx.mileageDays;
      return {
        body: {
          days,
          totalDistanceMetres: days.reduce((sum, day) => sum + day.distanceMetres, 0),
        },
      };
    },
  },

  // --- call reports and samples ---------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.callReports,
    handler: (ctx) => ({ body: paginate(fx.callReports, ctx) }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.callReports,
    handler: (ctx) => ({ status: 201, body: withId(first(fx.callReports), ctx.body) }),
  },
  {
    method: 'POST',
    pattern: '/call-reports/:id/approval',
    handler: (ctx) => ({
      body: {
        ...first(fx.callReports),
        id: ctx.params['id'] ?? first(fx.callReports).id,
        status: asRecord(ctx.body)['approved'] === false ? 'rejected' : 'approved',
        approvedByUserId: fx.IDS.manager,
        approvedAt: '2026-08-10T14:00:00+05:30',
      },
    }),
  },
  {
    method: 'GET',
    pattern: API_PATHS.samplesAndInputs,
    handler: (ctx) => ({ body: paginate(fx.samplesAndInputs, ctx) }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.samplesAndInputs,
    handler: (ctx) => ({ status: 201, body: withId(first(fx.samplesAndInputs), ctx.body) }),
  },

  // --- consent --------------------------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.consentTextVersions,
    handler: (ctx) => ({ body: paginate(fx.consentTextVersions, ctx) }),
  },
  {
    method: 'GET',
    pattern: API_PATHS.consentTextActive,
    handler: (ctx) => {
      const language = ctx.query.get('language') ?? 'en-IN';
      const version =
        fx.consentTextVersions.find((v) => v.language === language) ??
        first(fx.consentTextVersions);
      return { body: version };
    },
  },
  {
    method: 'GET',
    pattern: API_PATHS.consentRecords,
    handler: (ctx) => {
      const visitId = ctx.query.get('visitId');
      const filtered =
        visitId === null
          ? fx.consentRecords
          : fx.consentRecords.filter((c) => c.visitId === visitId);
      return { body: paginate(filtered, ctx) };
    },
  },
  {
    // All three outcomes post here and all three return 201. There is no error
    // path for declining, and there must never be one.
    method: 'POST',
    pattern: API_PATHS.consentRecords,
    handler: (ctx) => {
      const body = asRecord(ctx.body);
      const outcome = body['outcome'];
      const template =
        fx.consentRecords.find((c) => c.outcome === outcome && !c.isWithdrawal) ??
        first(fx.consentRecords);
      return { status: 201, body: withId(template, ctx.body) };
    },
  },
  {
    method: 'POST',
    pattern: API_PATHS.consentWithdrawals,
    handler: (ctx) => {
      const withdrawal = fx.consentRecords.find((c) => c.isWithdrawal) ?? first(fx.consentRecords);
      return { status: 201, body: withId(withdrawal, ctx.body) };
    },
  },

  // --- capture and upload ---------------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.voiceNotes,
    handler: (ctx) => ({ body: paginate(fx.voiceNotes, ctx) }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.voiceNotes,
    handler: () => ({ status: 201, body: fx.uploadSession }),
  },
  {
    method: 'GET',
    pattern: API_PATHS.recordings,
    handler: (ctx) => ({ body: paginate(fx.recordings, ctx) }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.recordings,
    handler: () => ({ status: 201, body: fx.uploadSession }),
  },
  {
    // Resumable upload: reports how many bytes the server already holds, so the
    // client can restart from the right offset after a dropped connection.
    method: 'GET',
    pattern: '/uploads/:id',
    handler: (ctx) => ({
      body: { ...fx.uploadSession, uploadSessionId: ctx.params['id'] ?? fx.IDS.uploadSession },
    }),
  },
  {
    method: 'POST',
    pattern: API_PATHS.uploadCompletion,
    handler: () => ({ body: first(fx.recordings) }),
  },
  {
    method: 'GET',
    pattern: '/transcripts/:id',
    handler: (ctx) => {
      const transcript = fx.transcripts.find((t) => t.id === ctx.params['id']);
      return transcript === undefined ? notFound('transcript') : { body: transcript };
    },
  },

  // --- analyses -------------------------------------------------------------
  {
    method: 'GET',
    pattern: API_PATHS.analyses,
    handler: (ctx) => ({ body: paginate(fx.analyses, ctx) }),
  },
  {
    method: 'GET',
    pattern: '/analyses/:id',
    handler: (ctx) => {
      const analysis = fx.analyses.find((a) => a.id === ctx.params['id']);
      return analysis === undefined ? notFound('analysis') : { body: analysis };
    },
  },
  {
    method: 'POST',
    pattern: '/analyses/:id/response',
    handler: (ctx) => ({
      body: {
        ...first(fx.analyses),
        id: ctx.params['id'] ?? fx.IDS.analysis,
        mrResponse: asString(asRecord(ctx.body)['response'], ''),
        mrRespondedAt: '2026-08-10T17:00:00+05:30',
        mrViewedAt: '2026-08-10T12:10:00+05:30',
      },
    }),
  },
  {
    method: 'POST',
    pattern: '/analyses/:id/overrides',
    handler: (ctx) => ({
      status: 201,
      body: {
        ...first(fx.analysisOverrides),
        analysisId: ctx.params['id'] ?? fx.IDS.analysis,
        reason: asString(asRecord(ctx.body)['reason'], first(fx.analysisOverrides).reason),
      },
    }),
  },

  // --- offline sync ---------------------------------------------------------
  {
    method: 'POST',
    pattern: API_PATHS.syncPush,
    handler: (ctx) => {
      const items = asRecord(ctx.body)['items'];
      const list = Array.isArray(items) ? items : [];
      // Deterministic mix so the client's conflict and duplicate paths get exercised
      // rather than only the happy one.
      const statuses = ['accepted', 'duplicate', 'conflict', 'rejected'] as const;
      return {
        body: {
          results: list.map((item, index) => {
            const status = statuses[index % statuses.length] ?? 'accepted';
            return {
              id: asString(asRecord(item)['id'], fx.IDS.queuedVisit),
              status,
              serverPayload: status === 'conflict' ? { status: 'completed' } : null,
              error:
                status === 'rejected'
                  ? 'The visit this item refers to does not exist on the server.'
                  : null,
            };
          }),
          serverTime: '2026-08-10T17:05:00+05:30',
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: API_PATHS.syncPull,
    handler: (ctx) => ({
      body: {
        changes:
          ctx.scenario === 'empty'
            ? []
            : fx.syncQueue.map((item) => ({
                entity: item.entity,
                entityId: item.entityId,
                deleted: false,
                payload: item.payload,
                updatedAt: item.clientCreatedAt,
              })),
        serverTime: '2026-08-10T17:05:00+05:30',
        hasMore: false,
      },
    }),
  },
  {
    // Not in packages/core: an inspection route for the offline-sync scenario, so
    // Frontend can drive the sync-queue UI without a device.
    method: 'GET',
    pattern: '/sync/queue',
    handler: (ctx) => ({ body: paginate(fx.syncQueue, ctx) }),
  },
];

const notFound = (what: string): { status: number; body: unknown } => ({
  status: 404,
  body: {
    error: {
      code: 'not_found',
      message: `No such ${what}.`,
      requestId: 'mock-not-found',
      fieldErrors: null,
    } satisfies ApiError,
  },
});

// --- server ------------------------------------------------------------------

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
};

const resolveScenario = (req: IncomingMessage, query: URLSearchParams): Scenario => {
  const header = req.headers['x-mock-scenario'];
  const raw = (Array.isArray(header) ? header[0] : header) ?? query.get('_scenario') ?? 'populated';
  return raw as Scenario;
};

let requestCounter = 0;

export const createMockServer = (): Server =>
  createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      requestCounter += 1;
      const requestId = `mock-${String(requestCounter).padStart(6, '0')}`;
      const url = new URL(req.url ?? '/', 'http://localhost');
      const query = url.searchParams;
      const scenario = resolveScenario(req, query);

      const send = (status: number, body: unknown): void => {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': requestId,
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };

      if (req.method === 'OPTIONS') {
        send(204, undefined);
        return;
      }

      const failure = ERROR_SCENARIOS[scenario];
      if (failure !== undefined) {
        send(failure.status, {
          error: {
            code: failure.code,
            message: failure.message,
            requestId,
            fieldErrors:
              failure.code === 'validation_failed'
                ? { summary: ['A summary is required before submitting.'] }
                : null,
          } satisfies ApiError,
        });
        return;
      }

      const body = await readBody(req);

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const params = matchPath(route.pattern, url.pathname);
        if (params === null) continue;

        const result = route.handler({
          method: req.method ?? 'GET',
          path: url.pathname,
          query,
          scenario,
          params,
          body,
          requestId,
        });
        send(result.status ?? 200, result.body);
        return;
      }

      send(404, {
        error: {
          code: 'not_found',
          message: `No mock route for ${req.method ?? '?'} ${url.pathname}.`,
          requestId,
          fieldErrors: null,
        } satisfies ApiError,
      });
    })();
  });

export const startMockServer = async (
  port = Number(process.env['MOCK_PORT'] ?? 4010),
): Promise<{ server: Server; port: number; url: string; close: () => Promise<void> }> => {
  const server = createMockServer();
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  return {
    server,
    port: actualPort,
    url: `http://127.0.0.1:${String(actualPort)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
};
