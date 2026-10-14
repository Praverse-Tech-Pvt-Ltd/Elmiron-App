import { describe, expect, it } from 'vitest';
import {
  bulkOutcome,
  decisionLine,
  decisionRefusal,
  preview,
  queueRefusal,
  reportView,
  selectionLine,
  sentLine,
  visitDay,
} from './call-reports-text';
import type { CallReportRow } from './manager-rows';

const ROW: CallReportRow = {
  id: 'r1',
  visitId: 'v1',
  mrId: 'rep',
  summary: 'Discussed dosing.',
  productIds: ['p1', 'p-gone'],
  objections: '  ',
  nextStep: 'Follow up on Friday',
  status: 'submitted',
  effectiveStatus: 'submitted',
  draftSource: 'voice_note',
  version: 2,
  // 18:05 in India.
  createdAt: '2026-10-14T12:35:00Z',
  decidedAt: null,
  decidedBy: null,
  approved: null,
};

const LOOK = {
  people: new Map([
    ['rep', 'Rep 1 (Pune)'],
    ['mgr', 'Meera Manager'],
  ]),
  visits: new Map([
    [
      'v1',
      {
        doctorId: 'd1',
        startedAt: '2026-10-13T20:00:00Z',
        completedAt: '2026-10-13T19:00:00Z',
        scheduledFor: null,
      },
    ],
  ]),
  doctors: new Map([['d1', 'Dr Vikram Rao']]),
  products: new Map([['p1', 'Testoval']]),
};

describe('FE-W200 — a report in a manager’s words', () => {
  it('names the rep, the doctor and the products, and dates the visit in India', () => {
    const view = reportView(ROW, LOOK);
    expect(view.repName).toBe('Rep 1 (Pune)');
    expect(view.doctorName).toBe('Dr Vikram Rao');
    // 19:00 UTC on the 13th is 00:30 on the 14th in India: the visit's India date.
    expect(view.visitDay).toBe('14 Oct 2026');
    expect(view.sentAt).toBe('14 Oct 2026, 18:05');
    // A product the caller cannot read is counted, never dropped.
    expect(view.products).toEqual(['Testoval', 'A product no longer listed']);
    // A blank objection is "none recorded", not an empty box.
    expect(view.objections).toBeNull();
    expect(view.fromVoiceNote).toBe(true);
  });

  it('never prints an id for a name it could not read', () => {
    const view = reportView(
      { ...ROW, mrId: 'stranger', visitId: 'unseen' },
      { ...LOOK, people: new Map() },
    );
    expect(view.repName).toBe('Unknown rep');
    expect(view.doctorName).toBe('A doctor you cannot see');
    expect(view.visitDay).toBeNull();
  });

  it('dates a visit by when it ended, then when it started, then when it was planned', () => {
    expect(visitDay(undefined)).toBeNull();
    expect(
      visitDay({
        doctorId: null,
        startedAt: null,
        completedAt: null,
        scheduledFor: '2026-10-20T04:00:00Z',
      }),
    ).toBe('20 Oct 2026');
  });

  it('says who sent it, when, which version, and that a voice note drafted it', () => {
    expect(sentLine(reportView(ROW, LOOK))).toBe(
      'Sent by Rep 1 (Pune) on 14 Oct 2026, 18:05. This is version 2. Drafted from a voice note.',
    );
    expect(sentLine(reportView({ ...ROW, version: 1, draftSource: 'manual' }, LOOK))).toBe(
      'Sent by Rep 1 (Pune) on 14 Oct 2026, 18:05.',
    );
  });

  it('says what was decided, by whom and when', () => {
    const decided = reportView(
      {
        ...ROW,
        effectiveStatus: 'rejected',
        decidedBy: 'mgr',
        decidedAt: '2026-10-15T04:30:00Z',
        approved: false,
      },
      LOOK,
    );
    expect(decisionLine(decided)).toBe('Not approved by Meera Manager on 15 Oct 2026, 10:00.');
    expect(decisionLine({ ...decided, effectiveStatus: 'approved', decidedByName: null })).toBe(
      'Approved on 15 Oct 2026, 10:00.',
    );
    expect(decisionLine({ ...decided, effectiveStatus: 'draft' })).toBe(
      'The rep has not sent this report for approval yet.',
    );
  });

  it('cuts a long summary at a word, and leaves a short one alone', () => {
    expect(preview('Short and   sweet.')).toBe('Short and sweet.');
    const long = 'word '.repeat(60);
    const cut = preview(long, 40);
    expect(cut.endsWith('word…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(41);
  });
});

describe('FE-W200 — the server’s refusals, in plain words', () => {
  it('names each refusal approve_call_report raises', () => {
    expect(decisionRefusal({ message: 'the author of a call report may not decide it' })).toBe(
      'You wrote this report, so somebody else has to decide it.',
    );
    expect(
      decisionRefusal({ message: 'call report abc is not in your scope', code: '42501' }),
    ).toBe('This report is from a rep outside your team, so you cannot decide it.');
    expect(
      decisionRefusal({
        message: 'call report abc is draft; only a submitted report can be decided',
      }),
    ).toBe('This report is not waiting for a decision: the rep has not sent it for approval.');
    expect(
      decisionRefusal({ message: 'call report abc has been superseded by a newer version' }),
    ).toBe('The rep has sent a newer version of this report. Reload the page to read it.');
    expect(
      decisionRefusal({ message: 'only a field_manager or admin may decide a call report' }),
    ).toBe('Only a field manager or an admin decides a call report.');
    expect(decisionRefusal({ message: 'not authenticated', code: '28000' })).toMatch(
      /Sign in again/u,
    );
    // Anything unnamed is still shown, never swallowed.
    expect(decisionRefusal({ message: 'something new' })).toBe(
      'The server refused this: something new',
    );
    expect(queueRefusal({ message: 'boom' })).toMatch(/could not be read.*boom/u);
  });

  it('reports a bulk approval as the server answered it, naming what was not approved', () => {
    const said = bulkOutcome(
      {
        results: [
          { id: 'a', decided: true, error: null },
          { id: 'b', decided: true, error: null },
          { id: 'c', decided: false, error: 'call report c is not in your scope' },
        ],
        truncated: false,
      },
      (id) => (id === 'c' ? 'Rep 2 (Mumbai), Dr Shah' : id),
    );
    expect(said.approved).toBe('Approved 2 reports.');
    expect(said.refused).toEqual([
      'Rep 2 (Mumbai), Dr Shah: This report is from a rep outside your team, so you cannot decide it.',
    ]);
    expect(
      bulkOutcome(
        { results: [{ id: 'a', decided: true, error: null }], truncated: true },
        (id) => id,
      ),
    ).toEqual({
      approved: 'Approved 1 report.',
      refused: [
        'More reports were ticked than can be approved at once. The rest are still waiting.',
      ],
    });
    expect(
      bulkOutcome(
        { results: [{ id: 'a', decided: false, error: null }], truncated: false },
        () => 'x',
      ).approved,
    ).toBe('No report was approved.');
  });

  it('counts what is waiting and what is ticked, with agreeing nouns', () => {
    expect(selectionLine(1, 0)).toBe('1 report is waiting for you.');
    expect(selectionLine(5, 0)).toBe('5 reports are waiting for you.');
    expect(selectionLine(5, 2)).toBe('2 of 5 reports ticked.');
  });
});
