import { describe, expect, it } from 'vitest';
import { TeamExceptionKindSchema, TeamExceptionSchema } from './manager.js';

/**
 * `BE-W217` — every kind `public.team_exception_kind` carries, so a real `team_exceptions()` answer
 * parses. The shift-window row is shaped as `20260815000200_exceptions_from_config.sql` builds it.
 */
describe('TeamExceptionKindSchema', () => {
  it('knows every kind the database emits', () => {
    expect(TeamExceptionKindSchema.options).toEqual([
      'missed_visits',
      'no_recent_sync',
      'high_rejection_rate',
      'consent_rate_anomaly',
      'org_default_shift_window',
    ]);
  });

  it('parses an org_default_shift_window exception', () => {
    const row = TeamExceptionSchema.parse({
      mrId: '6f1c2b8e-3d4a-4e5f-8a9b-0c1d2e3f4a5b',
      exceptionKind: 'org_default_shift_window',
      detail: {
        captureCount: 3,
        firstAt: '2026-10-14T03:45:00.000Z',
        signal: 'unconfigured_territory',
        note: 'These captures were judged against the organisation default.',
      },
    });
    expect(row.exceptionKind).toBe('org_default_shift_window');
  });

  it('still refuses a kind the database does not have', () => {
    expect(TeamExceptionKindSchema.safeParse('ranking').success).toBe(false);
  });
});
