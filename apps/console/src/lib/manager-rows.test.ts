import { describe, expect, it } from 'vitest';
import {
  parseAll,
  parseBulkDecision,
  parseCallReport,
  parseCoverage,
  parseTeamException,
} from './manager-rows';

const REPORT = {
  id: '11111111-1111-4111-8111-111111111111',
  visit_id: '22222222-2222-4222-8222-222222222222',
  mr_id: '33333333-3333-4333-8333-333333333333',
  summary: 'Discussed the new pack.',
  product_ids_discussed: ['44444444-4444-4444-8444-444444444444'],
  objections_raised: null,
  next_step: 'Leave samples next week',
  status: 'submitted',
  draft_source: 'manual',
  created_at: '2026-10-14T12:35:00+00:00',
  updated_at: '2026-10-14T12:35:00+00:00',
  received_at: '2026-10-14T12:35:00+00:00',
  version: 1,
  supersedes_call_report_id: null,
  approval_decision: null,
  decided_by_user_id: null,
  decided_at: null,
  effective_status: 'submitted',
};

describe('FE-W200 — the manager functions’ rows are parsed as PostgREST sends them', () => {
  it('reads a call_report_current row in snake_case', () => {
    expect(parseCallReport(REPORT)).toEqual({
      id: REPORT.id,
      visitId: REPORT.visit_id,
      mrId: REPORT.mr_id,
      summary: 'Discussed the new pack.',
      productIds: ['44444444-4444-4444-8444-444444444444'],
      objections: null,
      nextStep: 'Leave samples next week',
      status: 'submitted',
      effectiveStatus: 'submitted',
      draftSource: 'manual',
      version: 1,
      createdAt: REPORT.created_at,
      decidedAt: null,
      decidedBy: null,
      approved: null,
    });
  });

  it('treats a null product list as none, and refuses a row that is not the shape', () => {
    expect(parseCallReport({ ...REPORT, product_ids_discussed: null })?.productIds).toEqual([]);
    expect(parseCallReport({ ...REPORT, mrId: REPORT.mr_id, mr_id: undefined })).toBeNull();
    expect(parseCallReport({ ...REPORT, version: 0 })).toBeNull();
    expect(parseCallReport({ ...REPORT, approval_decision: 'yes' })).toBeNull();
    expect(parseCallReport(null)).toBeNull();
  });

  it('refuses the whole list when one row is wrong, rather than drawing half of it', () => {
    expect(parseAll([REPORT, REPORT], parseCallReport)).toHaveLength(2);
    expect(parseAll([REPORT, { id: 'x' }], parseCallReport)).toBeNull();
    expect(parseAll({ rows: [] }, parseCallReport)).toBeNull();
    expect(parseAll([], parseCallReport)).toEqual([]);
  });

  it('reads the bulk verdicts, and whether the server stopped short', () => {
    expect(
      parseBulkDecision({
        results: [
          { id: 'a', decided: true, error: null },
          { id: 'b', decided: false, error: 'the author of a call report may not decide it' },
        ],
        decidedCount: 1,
        notDecidedCount: 1,
        submittedCount: 2,
        truncated: false,
        limit: 200,
        serverTime: '2026-10-15T05:00:00+00:00',
      }),
    ).toEqual({
      results: [
        { id: 'a', decided: true, error: null },
        { id: 'b', decided: false, error: 'the author of a call report may not decide it' },
      ],
      truncated: false,
    });
    expect(parseBulkDecision({ results: [{ id: 'a' }] })).toBeNull();
  });

  it('reads team_exceptions rows, any kind, with their detail', () => {
    expect(
      parseTeamException({
        mr_id: 'm',
        exception_kind: 'org_default_shift_window',
        detail: { captureCount: 2 },
      }),
    ).toEqual({ mrId: 'm', kind: 'org_default_shift_window', detail: { captureCount: 2 } });
    expect(parseTeamException({ mr_id: 'm', exception_kind: 'x', detail: null })).toBeNull();
  });

  it('reads coverage rows, and refuses a negative or fractional count', () => {
    const row = {
      mr_id: 'm',
      coverage_date: '2026-10-14',
      planned_visit_count: 3,
      actual_visit_count: 2,
      missed_visit_count: 1,
      day_zone: 'Asia/Kolkata',
      day_zone_source: 'territory',
    };
    expect(parseCoverage(row)).toEqual({
      mrId: 'm',
      day: '2026-10-14',
      planned: 3,
      completed: 2,
      notSeen: 1,
      zone: 'Asia/Kolkata',
      zoneSource: 'territory',
    });
    expect(parseCoverage({ ...row, planned_visit_count: -1 })).toBeNull();
    expect(parseCoverage({ ...row, actual_visit_count: 1.5 })).toBeNull();
  });
});
