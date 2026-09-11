import { describe, expect, it } from 'vitest';
import { SyncRejectionCodeSchema } from '@fieldforce/core';
import { presentRejection, refusalTextFor } from './explanation';
import type { RejectionRecord } from './reducer';

const record = (over: Partial<RejectionRecord> = {}): RejectionRecord => ({
  code: 'outside_shift_window',
  // MR-17 B1. Null by default: these cases predate the SQLSTATE and are about the queue
  // CODE, so they must keep asserting that behaviour unchanged. The SQLSTATE cases are
  // their own describe block below.
  sqlState: null,
  explanation: 'This visit was recorded outside your territory working hours.',
  attemptsRemaining: 2,
  deadLettered: false,
  receivedAt: '2026-08-14T10:00:00.000Z',
  ...over,
});

describe('presentRejection', () => {
  it("passes the server's sentence through unchanged", () => {
    // Backend's rejection sentences are tested server-side and rewording one breaks
    // a build deliberately. This asserts the client is a pipe, not an author.
    const sentence = 'This visit was recorded outside your territory working hours.';
    expect(presentRejection(record({ explanation: sentence })).explanation).toBe(sentence);
  });

  it('does not invent prose when the server sent no sentence', () => {
    const presented = presentRejection(record({ explanation: null }));
    expect(presented.explanation).toBeNull();
    // The fallback says the app does not have the reason — which is true — rather
    // than guessing at one, which might name the wrong cause.
    expect(presented.fallback).toMatch(/without a reason the app can show/);
    expect(presented.fallback).not.toMatch(/shift|geofence|territory|hours|location/iu);
  });

  it('offers no fallback when there is a real sentence to show', () => {
    expect(presentRejection(record()).fallback).toBeNull();
  });

  it('handles every code in the contract, so a new one cannot fall through', () => {
    // If Backend adds a rejection code, this fails rather than silently rendering
    // an undefined action for it.
    for (const code of SyncRejectionCodeSchema.options) {
      const presented = presentRejection(record({ code }));
      expect(presented.code).toBe(code);
      expect(['retry', 'escalate']).toContain(presented.action);
    }
  });

  it.each(['outside_shift_window', 'missing_reference', 'internal_error'] as const)(
    'offers a retry for %s, whose cause can change without the MR doing anything',
    (code) => {
      expect(presentRejection(record({ code })).action).toBe('retry');
    },
  );

  it.each(['outside_geofence', 'not_your_record', 'validation_failed', 'malformed_item'] as const)(
    'sends %s to a person rather than looping on a retry that cannot work',
    (code) => {
      expect(presentRejection(record({ code })).action).toBe('escalate');
    },
  );

  it('escalates a dead letter even when the code would otherwise be retryable', () => {
    // Attempts are exhausted. Offering a retry would be offering a button that
    // cannot do anything, which is worse than offering none.
    const presented = presentRejection(
      record({ code: 'outside_shift_window', deadLettered: true, attemptsRemaining: 0 }),
    );
    expect(presented.action).toBe('escalate');
    expect(presented.deadLettered).toBe(true);
  });
});

/**
 * MR-17 B2 — each SQLSTATE reaches the MR with ITS OWN remedy.
 *
 * `BE-W75` put `sqlState` on the sync verdict and the client dropped it, so
 * `rejectionCodeFor` collapsed 45001, 45004, 45007 and 45008 onto `internal_error` and all
 * four would have reached the MR as one generic failure. These assert the codes
 * individually rather than asserting that the pipe exists — if they only ever failed
 * together, they would be testing the threading and not the mapping.
 */
describe('MR-17 B2 — a SQLSTATE carries its own remedy', () => {
  /** The queue code is deliberately the SAME for all of them: `internal_error`. */
  const refused = (sqlState: string | null): RejectionRecord =>
    record({ code: 'internal_error', sqlState, explanation: null });

  it('45001 — the notice changed: re-read the current one and ask again', () => {
    const shown = presentRejection(refused('45001'));
    expect(shown.refusalCode).toBe('consent_notice_superseded');
    expect(shown.remedy).toMatch(/read the current notice/i);
    // And never one of the others. The whole defect was four codes sharing one sentence.
    expect(shown.remedy).not.toMatch(/clock|UCPMP|sync sooner/i);
  });

  it('45007 — the clock, and it does NOT tell them to re-ask the doctor', () => {
    // Telling an MR to repeat a consent conversation because their phone is fast would be
    // useless and slightly insulting. The remedy is the phone.
    const shown = presentRejection(refused('45007'));
    expect(shown.refusalCode).toBe('consent_captured_in_future');
    expect(shown.remedy).toMatch(/clock/i);
    expect(shown.remedy).not.toMatch(/ask (the doctor|once more|again)/i);
  });

  it('45008 — sync sooner, which is a different remedy from 45001', () => {
    // These two are separate codes precisely because the remedy differs: 45001 means the
    // notice moved, 45008 means this consent was valid when taken and arrived too late.
    const shown = presentRejection(refused('45008'));
    expect(shown.refusalCode).toBe('consent_too_old_to_accept');
    expect(shown.remedy).toMatch(/sync sooner/i);
    expect(shown.remedy).not.toMatch(/read the current notice/i);
  });

  it('45004 — the UCPMP cap, and it says stop rather than retry', () => {
    const shown = presentRejection(refused('45004'));
    expect(shown.refusalCode).toBe('ucpmp_sample_cap_exceeded');
    expect(shown.remedy).toMatch(/UCPMP limit/i);
    expect(shown.remedy).toMatch(/manager/i);
  });

  it('an UNMAPPED code renders the honest fallback, never a guessed remedy', () => {
    // `refusalForSqlState` returns `unrecognised` for anything it does not know, and
    // `unrecognised` has no entry in REMEDIES on purpose. A guessed remedy sends the MR to
    // do the wrong thing with no way to tell it is wrong.
    const shown = presentRejection(refused('99999'));
    expect(shown.refusalCode).toBe('unrecognised');
    expect(shown.remedy).toBeNull();
    expect(shown.fallback).toMatch(/without a reason the app can show/i);
  });

  it('and so does a MISSING code — null is not an excuse to invent one', () => {
    // The REST path carries no SQLSTATE at all. It must behave like an unknown one.
    const shown = presentRejection(refused(null));
    expect(shown.refusalCode).toBe('unrecognised');
    expect(shown.remedy).toBeNull();
  });

  it('asserts its own precondition: all four share ONE queue code', () => {
    // If `rejectionCode` ever became specific, these cases would pass for the wrong reason
    // -- the remedy could be keyed off the queue code and nobody would notice the SQLSTATE
    // was still being dropped. This says the queue code cannot be doing the work.
    const codes = ['45001', '45004', '45007', '45008'].map(
      (state) => presentRejection(refused(state)).code,
    );
    expect(new Set(codes).size, 'the queue code now discriminates; re-check these tests').toBe(1);
    expect(codes[0]).toBe('internal_error');
  });
});

describe('BE-W97 — refusalTextFor: the remedy AND the server\u2019s figures', () => {
  /** Exactly what `sendOrQueue` hands a screen that was refused in the moment. */
  const refusal = (over: Partial<Parameters<typeof refusalTextFor>[0]> = {}) => ({
    sqlState: '45004',
    message: 'this would put Elmiron 100mg over the UCPMP cap for Dr. S. Iyer this month',
    detail: 'cap 1, already given 0, this entry 2, period starting 2026-09-01',
    ...over,
  });

  it('puts the cap, the month-to-date, this entry and the period on the screen', () => {
    // The brief\u2019s own test for `G-WRITE`, and what MR-27 C2 could not satisfy: a real
    // 45004 reached the MR as a sentence containing a doctor UUID and no numbers at all.
    const text = refusalTextFor(refusal());
    expect(text).toContain('cap 1');
    expect(text).toContain('already given 0');
    expect(text).toContain('this entry 2');
    expect(text).toContain('period starting 2026-09-01');
  });

  it('leads with the REMEDY, because it is the only part that is an instruction', () => {
    const text = refusalTextFor(refusal());
    expect(text).toMatch(/^This would go past the UCPMP limit/);
    expect(text).toMatch(/manager/i);
    // And the figures come after it, not before. An MR reading the first line must get the
    // action; numbers first would bury it.
    expect(text.indexOf('manager')).toBeLessThan(text.indexOf('cap 1'));
  });

  it('ATTRIBUTES the figures to the server rather than speaking them as its own', () => {
    // MR-15\u2019s rule reaches the voice a sentence is said in, not only the number in it.
    // The app did not count these and must not appear to have.
    expect(refusalTextFor(refusal())).toMatch(/Figures from the server:/);
  });

  it('falls back to the SERVER\u2019S sentence when the code has no remedy', () => {
    // An unmapped SQLSTATE has no remedy on purpose. The message is then the only true
    // thing available, and the figures still travel with it.
    const text = refusalTextFor(refusal({ sqlState: '99999' }));
    expect(text).toContain('over the UCPMP cap');
    expect(text).toContain('cap 1');
    expect(text).not.toMatch(/UCPMP limit for this doctor/);
  });

  it('says NOTHING extra when the server sent no figures \u2014 all three spellings', () => {
    // MR-26 C: missing, null and empty string are the three spellings of absent, and they
    // all interpolated into the same empty parentheses on a screen. Whitespace is the
    // fourth and is the one a `format()` with a null argument can produce.
    for (const detail of [null, '', '   ']) {
      const text = refusalTextFor(refusal({ detail }));
      expect(text).not.toMatch(/Figures from the server/);
      expect(text).not.toMatch(/:\s*\.$/);
      expect(text).toBe(
        'This would go past the UCPMP limit for this doctor this month. Do not hand anything else over \u2014 speak to your manager first.',
      );
    }
  });

  it('carries the figures for every OTHER 450xx too, not just the cap', () => {
    // BE-W97 is a class, not a code. Fifteen raise sites attach a DETAIL and all fifteen
    // were dying in `sync_push`\u2019s handler. If this only worked for 45004 it would be the
    // special case the migration header argues against.
    const tooOld = refusalTextFor({
      sqlState: '45008',
      message: 'this consent was captured too long ago',
      detail: 'captured 4 days ago, the maximum is 72 hours',
    });
    expect(tooOld).toMatch(/sync sooner/i);
    expect(tooOld).toContain('the maximum is 72 hours');
  });
});
