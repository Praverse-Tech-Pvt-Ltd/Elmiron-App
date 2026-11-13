import { describe, expect, it } from 'vitest';
import {
  EXCEPTION_KINDS,
  exceptionDetail,
  exceptionLabel,
  exceptionMeaning,
  exceptionsByRep,
  exceptionsRefusal,
} from './team-exceptions-text';

describe('FE-W202 — each exception in plain words', () => {
  it('names and explains every kind the database emits, in one sentence each', () => {
    // The enum as installed: `team_exception_kind`, with `org_default_shift_window` added in
    // 20260815000100. Core's schema stops before that one; this list does not.
    expect([...EXCEPTION_KINDS]).toEqual([
      'missed_visits',
      'no_recent_sync',
      'high_rejection_rate',
      'consent_rate_anomaly',
      'org_default_shift_window',
    ]);
    for (const kind of EXCEPTION_KINDS) {
      expect(exceptionLabel(kind)).not.toMatch(/_/u);
      const meaning = exceptionMeaning(kind);
      // One sentence: one full stop, at the end.
      expect(meaning.match(/\.(\s|$)/gu)).toHaveLength(1);
      expect(meaning.endsWith('.')).toBe(true);
    }
    expect(exceptionLabel('something_new')).toBe('Something new');
  });

  it('says a consent difference is about the records, never about the rep', () => {
    const meaning = exceptionMeaning('consent_rate_anomaly');
    expect(meaning).toMatch(/quality/u);
    expect(meaning).toMatch(/never a measure of the rep/u);
    expect(
      exceptionDetail({
        kind: 'consent_rate_anomaly',
        detail: { rate: 1, teamMedian: 0.4, sampleSize: 6, signal: 'data_quality' },
      }),
    ).toBe(
      '100% of 6 consent records that day say the doctor consented; across the team the middle figure is 40%.',
    );
  });

  it('puts the numbers the function sent into sentences', () => {
    expect(exceptionDetail({ kind: 'missed_visits', detail: { missed: 2, planned: 5 } })).toBe(
      '2 of 5 planned doctors not seen.',
    );
    expect(exceptionDetail({ kind: 'missed_visits', detail: { missed: 1, planned: 1 } })).toBe(
      '1 of 1 planned doctor not seen.',
    );
    expect(
      exceptionDetail({
        kind: 'no_recent_sync',
        detail: { lastSuccessfulSyncAt: null, thresholdHours: 12 },
      }),
    ).toBe('Nothing has arrived from this rep’s phone yet. Your company’s limit is 12 hours.');
    expect(
      exceptionDetail({
        kind: 'no_recent_sync',
        detail: { lastSuccessfulSyncAt: '2026-10-14T12:35:00Z', thresholdHours: 12 },
      }),
    ).toBe('Last received 14 Oct 2026, 18:05. Your company’s limit is 12 hours.');
    expect(
      exceptionDetail({ kind: 'high_rejection_rate', detail: { rejected: 1, submitted: 4 } }),
    ).toBe('1 of 4 records sent that day was refused.');
    expect(
      exceptionDetail({
        kind: 'org_default_shift_window',
        detail: { captureCount: 2, firstAt: '2026-10-14T03:45:00Z' },
      }),
    ).toBe('2 check-ins were judged this way, the first on 14 Oct 2026, 09:15.');
    // A detail with nothing usable says nothing rather than "undefined of null".
    expect(exceptionDetail({ kind: 'missed_visits', detail: {} })).toBe('');
  });
});

describe('FE-W202 — reps by name, never ranked', () => {
  const names = new Map([
    ['z', 'Zara Khan'],
    ['a', 'Anil Rao'],
  ]);

  it('lists reps by name, not by how much came up for them', () => {
    const reps = exceptionsByRep(
      [
        { mrId: 'z', kind: 'missed_visits', detail: { missed: 1, planned: 3 } },
        { mrId: 'z', kind: 'no_recent_sync', detail: { lastSuccessfulSyncAt: null } },
        { mrId: 'z', kind: 'high_rejection_rate', detail: { rejected: 3, submitted: 5 } },
        { mrId: 'a', kind: 'no_recent_sync', detail: { lastSuccessfulSyncAt: null } },
        { mrId: 'nobody', kind: 'missed_visits', detail: { missed: 1, planned: 1 } },
      ],
      names,
    );
    expect(reps.map((r) => r.name)).toEqual(['Anil Rao', 'Unknown rep', 'Zara Khan']);
    expect(reps[2]?.items.map((i) => i.kind)).toEqual([
      'missed_visits',
      'no_recent_sync',
      'high_rejection_rate',
    ]);
  });

  it('marks the consent check as data quality', () => {
    const [rep] = exceptionsByRep(
      [{ mrId: 'a', kind: 'consent_rate_anomaly', detail: { signal: 'data_quality' } }],
      names,
    );
    expect(rep?.items[0]?.dataQuality).toBe(true);
  });

  it('says why the list could not be read', () => {
    expect(exceptionsRefusal({ message: 'not authenticated', code: '28000' })).toMatch(
      /Sign in again/u,
    );
    expect(exceptionsRefusal({ message: 'boom' })).toMatch(/could not be read.*boom/u);
  });
});
