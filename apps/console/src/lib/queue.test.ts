import { describe, expect, it } from 'vitest';
import { AnalysisSchema, ConsentRecordSchema } from '@fieldforce/core';
import type { Analysis, ConsentRecord } from '@fieldforce/core';
import { consentSignal, queueRows } from './queue.js';

const uuid = (suffix: string): string => `77777777-7777-4777-8777-7777777777${suffix}`;

const finding = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uuid('01'),
  analysisId: uuid('11'),
  category: 'objection_handling',
  severity: 'improvement',
  title: 'The cost objection was not answered.',
  detail: 'It moved to dosing.',
  citations: [
    {
      transcriptId: uuid('aa'),
      segmentId: uuid('bb'),
      startMs: 134_000,
      endMs: 151_000,
      quotedText: '…cost first.',
    },
  ],
  createdAt: '2026-08-14T19:00:00+05:30',
  ...over,
});

const analysis = (over: Record<string, unknown> = {}): Analysis =>
  AnalysisSchema.parse({
    id: uuid('11'),
    visitId: uuid('22'),
    mrId: uuid('33'),
    transcriptId: uuid('44'),
    status: 'completed',
    refusalReason: null,
    rubricVersion: 'r1',
    modelProvider: 'p',
    modelVersion: 'v',
    findings: [finding()],
    mrViewedAt: null,
    mrResponse: null,
    mrRespondedAt: null,
    generatedAt: '2026-08-14T19:00:00+05:30',
    createdAt: '2026-08-14T19:00:00+05:30',
    ...over,
  });

const consent = (over: Record<string, unknown> = {}): ConsentRecord =>
  ConsentRecordSchema.parse({
    id: uuid('c1'),
    visitId: uuid('22'),
    doctorId: uuid('d1'),
    capturedByMrId: uuid('33'),
    outcome: 'consented',
    notAskedReason: null,
    consentTextVersionId: uuid('e1'),
    displayedLanguage: 'en-IN',
    supersedesConsentRecordId: null,
    isWithdrawal: false,
    capturedAt: '2026-08-14T11:00:00+05:30',
    receivedAt: '2026-08-14T11:00:01+05:30',
    createdAt: '2026-08-14T11:00:01+05:30',
    ...over,
  });

/**
 * §3.6 bans a ranking, score, rank, percentile or grade "not for MRs, **not in the
 * console**, not 'just a sort order'", and `manager.ts` says adding an ordering
 * here "would invert the meaning of the whole surface". Neither §3.6 reversal on
 * 3 September touched that. These tests are what keep the queue a filter.
 */
describe('the queue is a filter, never a league table', () => {
  it('lists only what recurred, and leaves everyone else out', () => {
    const once = analysis({ id: uuid('11'), mrId: uuid('33') });
    const other = analysis({ id: uuid('12'), mrId: uuid('34') });
    expect(queueRows([once, other])).toHaveLength(0);
  });

  it('raises a row once a category repeats for the same MR', () => {
    const rows = queueRows([
      analysis({ id: uuid('11') }),
      analysis({ id: uuid('12'), visitId: uuid('23') }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences).toHaveLength(2);
    expect(rows[0]?.reviewed).toBe(2);
  });

  it('does not count what went well as a pattern to coach', () => {
    // A repeated `info` finding is the MR doing something right. Putting it in the
    // queue would make this a performance view of the person.
    const good = { findings: [finding({ severity: 'info' })] };
    expect(
      queueRows([analysis({ id: uuid('11'), ...good }), analysis({ id: uuid('12'), ...good })]),
    ).toHaveLength(0);
  });

  it('separates two different patterns for one MR into two conversations', () => {
    const rows = queueRows([
      analysis({ id: uuid('11') }),
      analysis({ id: uuid('12') }),
      analysis({
        id: uuid('13'),
        findings: [finding({ id: uuid('02'), category: 'call_to_action' })],
      }),
      analysis({
        id: uuid('14'),
        findings: [finding({ id: uuid('03'), category: 'call_to_action' })],
      }),
    ]);
    expect(rows.map((row) => row.category).sort()).toEqual([
      'call_to_action',
      'objection_handling',
    ]);
  });

  it('sorts by id, so no ordering can be read as a ranking', () => {
    // Deliberately meaningless. "Most findings first" or "least replied first"
    // would be a ranking wearing a sort order as a disguise.
    const rows = queueRows([
      analysis({ id: uuid('15'), mrId: uuid('39') }),
      analysis({ id: uuid('16'), mrId: uuid('39'), visitId: uuid('24') }),
      analysis({ id: uuid('17'), mrId: uuid('31') }),
      analysis({ id: uuid('18'), mrId: uuid('31'), visitId: uuid('25') }),
    ]);
    expect(rows.map((row) => row.mrId)).toEqual([uuid('31'), uuid('39')]);
  });

  it('carries the MR reply status, so a manager cannot open one without knowing', () => {
    const replied = queueRows([
      analysis({
        id: uuid('11'),
        mrResponse: 'I answered it.',
        mrRespondedAt: '2026-08-14T20:00:00+05:30',
      }),
      analysis({ id: uuid('12'), visitId: uuid('23') }),
    ]);
    expect(replied[0]?.replied).toBe(true);
  });
});

describe('the consent rate is a data-quality signal', () => {
  it('is a rate across the territory, with no per-MR figure returned at all', () => {
    const signal = consentSignal([
      consent({ id: uuid('c1') }),
      consent({ id: uuid('c2'), outcome: 'declined' }),
    ]);
    expect(signal).toEqual({ consented: 1, total: 2, rate: 50, perfect: [] });
    // A per-MR percentage column is a league table however it is labelled, so the
    // shape has nowhere to put one.
    expect(Object.keys(signal)).not.toContain('byMr');
  });

  it('flags a perfect scorer as something to look at, not as the top of a list', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      consent({ id: uuid(String(index).padStart(2, '0')) }),
    );
    expect(consentSignal(many).perfect).toEqual([uuid('33')]);
  });

  it('ignores an MR with too few visits to mean anything', () => {
    expect(consentSignal([consent()]).perfect).toEqual([]);
  });

  it('leaves withdrawals out of the rate', () => {
    // A withdrawal is a new row that supersedes; counting it as a fresh answer
    // would double-count the visit.
    const signal = consentSignal([consent(), consent({ id: uuid('c9'), isWithdrawal: true })]);
    expect(signal.total).toBe(1);
  });
});
