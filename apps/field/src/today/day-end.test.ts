import { describe, expect, it } from 'vitest';
import { VisitSchema } from '@fieldforce/core';
import type { Visit } from '@fieldforce/core';
import { CAPTURE_NOTE, summariseDayEnd } from './day-end';

/**
 * Parsed through the contract schema rather than written as a literal, for the
 * reason the queue tests give: a hand-written fixture that drifts from the
 * contract still passes, and a parse that drifts throws.
 */
const visit = (over: Partial<Visit> = {}): Visit =>
  VisitSchema.parse({
    id: '22222222-2222-4222-8222-222222222201',
    mrId: '22222222-2222-4222-8222-2222222222aa',
    doctorId: '22222222-2222-4222-8222-2222222222bb',
    beatPlanId: null,
    clinicAddressId: null,
    status: 'completed',
    notMetReason: null,
    scheduledFor: null,
    startedAt: '2026-08-13T08:55:00+05:30',
    completedAt: '2026-08-13T09:12:00+05:30',
    receivedAt: '2026-08-13T09:12:01+05:30',
    createdAt: '2026-08-13T08:00:00+05:30',
    updatedAt: '2026-08-13T09:12:01+05:30',
    ...over,
  });

describe('the day is counted the way B1 counts it', () => {
  it('leaves cancelled visits out of the count entirely', () => {
    const summary = summariseDayEnd([
      visit({ id: '22222222-2222-4222-8222-222222222201' }),
      visit({ id: '22222222-2222-4222-8222-222222222202', status: 'cancelled' }),
    ]);
    expect(summary.planned).toBe(1);
    expect(summary.done).toBe(1);
  });

  it('does not call an empty day a finished one', () => {
    // An MR whose plan never arrived has not worked through it. Telling them they
    // have is the same lie in the other direction that B1's empty card avoids.
    expect(summariseDayEnd([]).finished).toBe(false);
  });

  it('is finished only once every counted visit is complete', () => {
    const partly = summariseDayEnd([
      visit({ id: '22222222-2222-4222-8222-222222222201' }),
      visit({ id: '22222222-2222-4222-8222-222222222202', status: 'planned', completedAt: null }),
    ]);
    expect(partly.finished).toBe(false);
    expect(summariseDayEnd([visit()]).finished).toBe(true);
  });
});

describe('the stamps are the server’s, and no duration is computed from them', () => {
  it('takes the earliest check-in and the latest check-out', () => {
    const summary = summariseDayEnd([
      visit({
        id: '22222222-2222-4222-8222-222222222201',
        startedAt: '2026-08-13T11:56:00+05:30',
        completedAt: '2026-08-13T12:09:00+05:30',
      }),
      visit({
        id: '22222222-2222-4222-8222-222222222202',
        startedAt: '2026-08-13T08:55:00+05:30',
        completedAt: '2026-08-13T18:22:00+05:30',
      }),
    ]);
    expect(summary.firstCaptureAt).toBe('2026-08-13T08:55:00+05:30');
    expect(summary.lastCaptureAt).toBe('2026-08-13T18:22:00+05:30');
  });

  it('returns the timestamps untouched, never a duration between them', () => {
    // B7 draws "ran 9h 27m". The stamps are returned as the server sent them,
    // offset and all — nothing here subtracts, and nothing here re-expresses them
    // in the handset's timezone.
    const summary = summariseDayEnd([visit()]);
    expect(summary.firstCaptureAt).toBe('2026-08-13T08:55:00+05:30');
    expect(Object.keys(summary)).not.toContain('duration');
  });

  it('has no last capture when nothing has been checked out of', () => {
    const summary = summariseDayEnd([visit({ status: 'in_progress', completedAt: null })]);
    expect(summary.lastCaptureAt).toBeNull();
    expect(summary.firstCaptureAt).toBe('2026-08-13T08:55:00+05:30');
  });
});

describe('the capture note', () => {
  it('describes capture in the present tense, not as something that stopped at 18:22', () => {
    // The screen's load-bearing sentence. Written as a standing fact because under
    // fe-w3-spec §4a it is one: there is no background location, so this is true
    // between every press and not only after the last one.
    expect(CAPTURE_NOTE).toMatch(/only ever reads your position at the moment you press/u);
    expect(CAPTURE_NOTE).toMatch(/it is not reading it now/u);
  });
});
