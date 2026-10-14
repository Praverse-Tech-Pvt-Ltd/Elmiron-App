/**
 * `FE-W200`, `FE-W202`, `FE-W203` — the rows the manager functions return, as this console reads
 * them.
 *
 * **Why the shapes are here and not in `@fieldforce/core`.** `packages/core/src/field/manager.ts`
 * describes these functions in camelCase (`mrId`, `exceptionKind`), but PostgREST answers in the
 * column names the functions declare (`mr_id`, `exception_kind`), and core's exception kinds stop
 * before `org_default_shift_window`. The console reads PostgREST directly, so it declares what
 * PostgREST sends, here, beside the screens that read it.
 *
 * **Parsed, never cast.** Each row crosses a process boundary; a row that is not the shape below
 * makes its whole list `null`, and the page says it could not read the answer rather than drawing
 * half of it. No schema library: the console takes no new dependency for five small shapes.
 *
 * The functions themselves are `20260814000100_manager_surface.sql`, `approve_call_report` as
 * last replaced in `20260917000100_close_the_admin_escape.sql`, `team_exceptions` and
 * `approve_call_reports_bulk` as replaced in `20260815000200_exceptions_from_config.sql`, and
 * `coverage` as recreated in `20260921000200_one_day_rule.sql`. **Nothing here decides who may
 * see or decide what** — each function checks the caller itself.
 */
export const MANAGER_RPC = {
  approvableCallReports: 'approvable_call_reports',
  approveCallReport: 'approve_call_report',
  approveCallReportsBulk: 'approve_call_reports_bulk',
  teamExceptions: 'team_exceptions',
  coverage: 'coverage',
} as const;

type Obj = Readonly<Record<string, unknown>>;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Every row parsed, or `null` if the answer is not a list or any row is not the shape. */
export const parseAll = <T>(data: unknown, parse: (row: unknown) => T | null): T[] | null => {
  if (!Array.isArray(data)) return null;
  const rows: T[] = [];
  for (const raw of data) {
    const row = parse(raw);
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
};

/** One row of `call_report_current` — what `approvable_call_reports` returns, and the view itself. */
export interface CallReportRow {
  readonly id: string;
  readonly visitId: string;
  readonly mrId: string;
  readonly summary: string;
  readonly productIds: readonly string[];
  readonly objections: string | null;
  readonly nextStep: string | null;
  /** What the author set: `draft` or `submitted`. */
  readonly status: string;
  /** `draft` | `submitted` | `approved` | `rejected`: the status with the latest decision applied. */
  readonly effectiveStatus: string;
  /** `manual`, or `voice_note` when the rep drafted it from a voice note. */
  readonly draftSource: string;
  readonly version: number;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly approved: boolean | null;
}

export const parseCallReport = (raw: unknown): CallReportRow | null => {
  if (!isObj(raw)) return null;
  const products = raw['product_ids_discussed'];
  const approved = raw['approval_decision'];
  const version = raw['version'];
  if (
    !isText(raw['id']) ||
    !isText(raw['visit_id']) ||
    !isText(raw['mr_id']) ||
    !isText(raw['summary']) ||
    !(products === null || (Array.isArray(products) && products.every(isText))) ||
    !isTextOrNull(raw['objections_raised']) ||
    !isTextOrNull(raw['next_step']) ||
    !isText(raw['status']) ||
    !isText(raw['effective_status']) ||
    !isText(raw['draft_source']) ||
    !(typeof version === 'number' && Number.isInteger(version) && version >= 1) ||
    !isText(raw['created_at']) ||
    !isTextOrNull(raw['decided_at']) ||
    !isTextOrNull(raw['decided_by_user_id']) ||
    !(approved === null || typeof approved === 'boolean')
  ) {
    return null;
  }
  return {
    id: raw['id'],
    visitId: raw['visit_id'],
    mrId: raw['mr_id'],
    summary: raw['summary'],
    productIds: products ?? [],
    objections: raw['objections_raised'],
    nextStep: raw['next_step'],
    status: raw['status'],
    effectiveStatus: raw['effective_status'],
    draftSource: raw['draft_source'],
    version,
    createdAt: raw['created_at'],
    decidedAt: raw['decided_at'],
    decidedBy: raw['decided_by_user_id'],
    approved,
  };
};

/** One verdict from `approve_call_reports_bulk`: decided, or refused with the database's words. */
export interface BulkVerdict {
  readonly id: string;
  readonly decided: boolean;
  readonly error: string | null;
}

export interface BulkDecision {
  readonly results: readonly BulkVerdict[];
  /** More ids were sent than the function decides in one call; the rest were not touched. */
  readonly truncated: boolean;
}

export const parseBulkDecision = (raw: unknown): BulkDecision | null => {
  if (!isObj(raw)) return null;
  const results = parseAll(raw['results'], (row): BulkVerdict | null =>
    isObj(row) &&
    isText(row['id']) &&
    typeof row['decided'] === 'boolean' &&
    isTextOrNull(row['error'])
      ? { id: row['id'], decided: row['decided'], error: row['error'] }
      : null,
  );
  if (results === null) return null;
  return { results, truncated: raw['truncated'] === true };
};

/** One row of `team_exceptions`. `detail`'s keys depend on the kind; each is read where it is used. */
export interface TeamExceptionRow {
  readonly mrId: string;
  readonly kind: string;
  readonly detail: Obj;
}

export const parseTeamException = (raw: unknown): TeamExceptionRow | null =>
  isObj(raw) && isText(raw['mr_id']) && isText(raw['exception_kind']) && isObj(raw['detail'])
    ? { mrId: raw['mr_id'], kind: raw['exception_kind'], detail: raw['detail'] }
    : null;

/** One rep on one day, from `coverage`. */
export interface CoverageRow {
  readonly mrId: string;
  readonly day: string;
  readonly planned: number;
  /** Completed visits that day, planned or not. */
  readonly completed: number;
  /** Doctors on the plan with no completed visit that day — not a count difference. */
  readonly notSeen: number;
  readonly zone: string;
  /** `fallback_utc` when the rep's territory has no working hours: the day is the UTC date. */
  readonly zoneSource: string;
}

export const parseCoverage = (raw: unknown): CoverageRow | null =>
  isObj(raw) &&
  isText(raw['mr_id']) &&
  isText(raw['coverage_date']) &&
  isCount(raw['planned_visit_count']) &&
  isCount(raw['actual_visit_count']) &&
  isCount(raw['missed_visit_count']) &&
  isText(raw['day_zone']) &&
  isText(raw['day_zone_source'])
    ? {
        mrId: raw['mr_id'],
        day: raw['coverage_date'],
        planned: raw['planned_visit_count'],
        completed: raw['actual_visit_count'],
        notSeen: raw['missed_visit_count'],
        zone: raw['day_zone'],
        zoneSource: raw['day_zone_source'],
      }
    : null;
