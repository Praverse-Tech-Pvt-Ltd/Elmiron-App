import { describe, expect, it } from 'vitest';
import { AnalysisSchema, VisitSchema } from '@fieldforce/core';
import type { Analysis, Finding, Visit } from '@fieldforce/core';
import {
  isWorkedWell,
  orderedFindings,
  reviewedRatio,
  statusNote,
  timestampFrom,
  trendFor,
} from './feed';

const finding = (over: Partial<Finding> = {}): Record<string, unknown> => ({
  id: '55555555-5555-4555-8555-555555555501',
  analysisId: '55555555-5555-4555-8555-5555555555aa',
  category: 'objection_handling',
  severity: 'improvement',
  title: 'The cost objection was not answered.',
  detail: 'He raised cost and the conversation moved to dosing.',
  citations: [
    {
      transcriptId: '55555555-5555-4555-8555-5555555555bb',
      segmentId: '55555555-5555-4555-8555-5555555555cc',
      startMs: 134_000,
      endMs: 151_000,
      quotedText: '…my patients ask about cost first.',
    },
  ],
  createdAt: '2026-08-14T19:00:00+05:30',
  ...over,
});

/**
 * A valid v4 UUID from a two-hex-digit suffix.
 *
 * The fixtures are parsed through the contract schemas, so an id like "a" or "f1"
 * is rejected — which is the schemas doing their job and the reason short ids are
 * not used here.
 */
const uuid = (suffix: string): string => `55555555-5555-4555-8555-5555555555${suffix}`;

const analysis = (over: Record<string, unknown> = {}): Analysis =>
  AnalysisSchema.parse({
    id: '55555555-5555-4555-8555-555555555511',
    visitId: '55555555-5555-4555-8555-555555555522',
    mrId: '55555555-5555-4555-8555-555555555533',
    transcriptId: '55555555-5555-4555-8555-555555555544',
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

const visit = (id: string, status = 'completed'): Visit =>
  VisitSchema.parse({
    id,
    mrId: '55555555-5555-4555-8555-555555555533',
    doctorId: '55555555-5555-4555-8555-555555555566',
    beatPlanId: null,
    clinicAddressId: null,
    status,
    notMetReason: null,
    scheduledFor: null,
    startedAt: '2026-08-14T11:00:00+05:30',
    completedAt: '2026-08-14T11:30:00+05:30',
    receivedAt: '2026-08-14T11:30:01+05:30',
    createdAt: '2026-08-14T08:00:00+05:30',
    updatedAt: '2026-08-14T11:30:01+05:30',
  });

/**
 * §3.6 bans a ranking, score, rank, percentile or grade and calls it a regulatory
 * line. The 3 September decision reopened the coaching *screens*; it did not touch
 * the scoring ban. These are the tests that keep the two apart.
 */
describe('nothing here can become a score', () => {
  it('counts one behaviour per month and nothing else', () => {
    const points = trendFor(
      [
        analysis({ generatedAt: '2026-07-02T10:00:00+05:30' }),
        analysis({
          id: '55555555-5555-4555-8555-555555555512',
          generatedAt: '2026-08-02T10:00:00+05:30',
        }),
        analysis({
          id: '55555555-5555-4555-8555-555555555513',
          generatedAt: '2026-08-20T10:00:00+05:30',
        }),
      ],
      'objection_handling',
      ['2026-07', '2026-08'],
    );
    expect(points).toEqual([
      { label: '07', count: 1 },
      { label: '08', count: 2 },
    ]);
  });

  it('has nowhere to put another person’s number', () => {
    // The guard is the signature, not an assertion: `trendFor` takes one MR's
    // analyses and a category. A peer, a team average or a target would have to be
    // a new parameter, which is a visible change rather than a silent one.
    expect(trendFor.length).toBe(3);
  });

  it('counts only the category asked for', () => {
    const mixed = analysis({
      findings: [finding(), finding({ id: uuid('01'), category: 'opening', severity: 'info' })],
    });
    expect(trendFor([mixed], 'objection_handling', ['2026-08'])[0]?.count).toBe(1);
    expect(trendFor([mixed], 'opening', ['2026-08'])[0]?.count).toBe(1);
    expect(trendFor([mixed], 'follow_through', ['2026-08'])[0]?.count).toBe(0);
  });

  it('reads the month off the server stamp rather than parsing it', () => {
    // Parsing re-expresses the month in the handset's timezone, which at a month
    // boundary moves a finding into the wrong bar.
    const late = analysis({ generatedAt: '2026-08-31T23:30:00+05:30' });
    expect(trendFor([late], 'objection_handling', ['2026-08'])[0]?.count).toBe(1);
    expect(trendFor([late], 'objection_handling', ['2026-09'])[0]?.count).toBe(0);
  });
});

describe('the sampling ratio', () => {
  it('counts distinct visits looked at against visits that happened', () => {
    const ratio = reviewedRatio(
      [analysis(), analysis({ id: uuid('02') })],
      [visit('55555555-5555-4555-8555-555555555522'), visit(uuid('03')), visit(uuid('04'))],
    );
    // Two analyses of the same visit is one visit reviewed.
    expect(ratio).toEqual({ reviewed: 1, total: 3 });
  });

  it('leaves cancelled visits out of the denominator', () => {
    const ratio = reviewedRatio([], [visit(uuid('05')), visit(uuid('06'), 'cancelled')]);
    expect(ratio.total).toBe(1);
  });

  it('counts a refused analysis as reviewed — the visit was still looked at', () => {
    const ratio = reviewedRatio(
      [analysis({ status: 'refused', refusalReason: 'Nothing citable.', findings: [] })],
      [visit('55555555-5555-4555-8555-555555555522')],
    );
    expect(ratio.reviewed).toBe(1);
  });
});

describe('findings', () => {
  it('puts what worked before what to try', () => {
    const both = analysis({
      findings: [finding({ id: uuid('0b') }), finding({ id: uuid('0a'), severity: 'info' })],
    });
    expect(orderedFindings(both).map((f) => f.id)).toEqual([uuid('0a'), uuid('0b')]);
  });

  it('drops nothing, however many improvements arrive', () => {
    // "Never a list of six failures" is an obligation on the rubric. A screen that
    // truncated would hide a finding the MR has a right to contest.
    const many = analysis({
      findings: [1, 2, 3, 4, 5, 6].map((n) => finding({ id: uuid(`1${String(n)}`) })),
    });
    expect(orderedFindings(many)).toHaveLength(6);
  });

  it.each([
    ['concern', false],
    ['improvement', false],
    ['info', true],
  ] as const)('treats %s as workedWell=%s, so severity is not a ranking', (severity, expected) => {
    // `concern` and `improvement` collapse into the same MR-facing kind. Giving
    // `concern` a louder treatment would reintroduce severity as a ranking of the
    // person through the back door.
    const [only] = analysis({ findings: [finding({ severity })] }).findings;
    expect(only).toBeDefined();
    if (only === undefined) return;
    expect(isWorkedWell(only)).toBe(expected);
  });
});

describe('a refusal is not an error', () => {
  it('says the system declined to guess, and uses the server’s reason when there is one', () => {
    expect(statusNote(analysis({ status: 'refused', refusalReason: 'No citable moment.' }))).toBe(
      'No citable moment.',
    );
    expect(statusNote(analysis({ status: 'refused', refusalReason: null }))).toMatch(
      /working, not failing/u,
    );
  });

  it('says nobody has seen anything when processing failed', () => {
    expect(statusNote(analysis({ status: 'failed' }))).toMatch(/Nobody has seen anything/u);
  });

  it('is silent for a completed analysis, so the findings speak', () => {
    expect(statusNote(analysis())).toBeNull();
  });
});

describe('timestamps', () => {
  it.each([
    [0, '00:00'],
    [4_000, '00:04'],
    [134_000, '02:14'],
    [3_661_000, '61:01'],
  ])('renders %i ms as %s', (ms, expected) => {
    expect(timestampFrom(ms)).toBe(expected);
  });
});
