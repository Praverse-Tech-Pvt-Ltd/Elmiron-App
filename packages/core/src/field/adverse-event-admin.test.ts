import { describe, expect, it } from 'vitest';
import {
  ADVERSE_EVENT_ADMIN_RPC,
  ADVERSE_EVENT_LIST_DEFAULT,
  ADVERSE_EVENT_LIST_MAX,
  AdverseEventDetailSchema,
  AdverseEventListRowSchema,
  AdverseEventListSchema,
  AdverseEventReadSchema,
  adverseEventListArgs,
} from './adverse-event-admin.js';

/**
 * `BE-W216` — the contract half of the adverse-event admin reads. The rules (admin only, own
 * organisation, reason, audit) are the database's and are tested there
 * (`services/api/tests/adverse-event-admin-read.spec.ts`, which parses every answer with these
 * schemas). This pins the shape: the list carries no `reportedText`, a read of nothing is `null`,
 * and the cursor reaches the database exactly as it left it.
 */

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  visitId: '22222222-2222-4222-8222-222222222222',
  source: 'mr_reported',
  // Microseconds, as Postgres writes a timestamptz into jsonb.
  receivedAt: '2026-10-14T19:06:26.566644+00:00',
  statutoryDueAt: '2026-10-29T19:06:26.566644+00:00',
  hoursRemaining: 359,
  overdue: false,
  reportedByMrId: '33333333-3333-4333-8333-333333333333',
  reportedByName: 'Pune Rep',
  doctorId: '44444444-4444-4444-8444-444444444444',
  doctorName: 'Dr Pune Fixture',
  visitDate: '2026-10-15',
} as const;

describe('the RPC names (BE-W215)', () => {
  it('are the database functions', () => {
    expect(ADVERSE_EVENT_ADMIN_RPC).toEqual({
      clockSummary: 'adverse_event_clock_summary',
      list: 'list_adverse_events',
      read: 'read_adverse_event',
    });
  });
});

describe('the list', () => {
  it('parses a page, and a detection with nobody’s name on it', () => {
    const page = {
      data: [
        ROW,
        {
          ...ROW,
          id: '55555555-5555-4555-8555-555555555555',
          source: 'transcript_detected',
          reportedByMrId: null,
          reportedByName: null,
          hoursRemaining: -3,
          overdue: true,
          visitDate: null,
        },
      ],
      nextBeforeReceivedAt: ROW.receivedAt,
      nextBeforeId: ROW.id,
      readAt: '2026-10-14T19:06:27.000001+00:00',
      auditLogId: 42,
    };
    expect(AdverseEventListSchema.safeParse(page).success).toBe(true);
    expect(
      AdverseEventListSchema.safeParse({ ...page, nextBeforeReceivedAt: null, nextBeforeId: null })
        .success,
    ).toBe(true);
  });

  it('has no field for the rep’s words, and drops one if it ever arrives', () => {
    expect(Object.keys(AdverseEventListRowSchema.shape)).not.toContain('reportedText');
    const parsed = AdverseEventListRowSchema.parse({ ...ROW, reportedText: 'should not be here' });
    expect(parsed).not.toHaveProperty('reportedText');
  });

  it('refuses a row with no clock', () => {
    expect(AdverseEventListRowSchema.safeParse({ ...ROW, statutoryDueAt: undefined }).success).toBe(
      false,
    );
  });
});

describe('a read', () => {
  const detail = {
    ...ROW,
    reportedText: 'Prescriber mentioned a reaction during the call. No patient named.',
    redactedTranscriptId: null,
    transcriptSegmentId: null,
    clientReportedAt: '2026-10-14T19:05:00+05:30',
    createdAt: ROW.receivedAt,
  };

  it('carries the words', () => {
    const parsed = AdverseEventReadSchema.parse({
      data: detail,
      readAt: ROW.receivedAt,
      auditLogId: 7,
    });
    expect(parsed.data?.reportedText).toBe(detail.reportedText);
    expect(AdverseEventDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('is null for an id that is not in the caller’s company — the same answer either way', () => {
    const parsed = AdverseEventReadSchema.parse({
      data: null,
      readAt: ROW.receivedAt,
      auditLogId: 8,
    });
    expect(parsed.data).toBeNull();
  });
});

describe('adverseEventListArgs', () => {
  it('asks for the first page with the default size', () => {
    expect(adverseEventListArgs('Weekly PV review')).toEqual({
      p_reason: 'Weekly PV review',
      p_limit: ADVERSE_EVENT_LIST_DEFAULT,
      p_before_received_at: null,
      p_before_id: null,
    });
  });

  it('passes the cursor through untouched, microseconds and all', () => {
    const args = adverseEventListArgs('Weekly PV review', {
      after: { nextBeforeReceivedAt: ROW.receivedAt, nextBeforeId: ROW.id },
    });
    // A `Date` round trip would give `.566Z` and skip every row between .566000 and .566644.
    expect(args.p_before_received_at).toBe('2026-10-14T19:06:26.566644+00:00');
    expect(args.p_before_id).toBe(ROW.id);
  });

  it('sends no cursor after the last page', () => {
    const args = adverseEventListArgs('r', {
      after: { nextBeforeReceivedAt: null, nextBeforeId: null },
    });
    expect(args.p_before_received_at).toBeNull();
    expect(args.p_before_id).toBeNull();
  });

  it('clamps the size as the database does', () => {
    expect(adverseEventListArgs('r', { limit: 0 }).p_limit).toBe(1);
    expect(adverseEventListArgs('r', { limit: 10_000 }).p_limit).toBe(ADVERSE_EVENT_LIST_MAX);
    expect(adverseEventListArgs('r', { limit: Number.NaN }).p_limit).toBe(
      ADVERSE_EVENT_LIST_DEFAULT,
    );
  });
});
