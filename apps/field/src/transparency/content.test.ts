import { describe, expect, it } from 'vitest';
import type { TransparencyEntry } from '@fieldforce/ui';
import { NEVER_RECORDED, TRANSPARENCY_ENTRIES, TRANSPARENCY_PREAMBLE } from './content';

/**
 * MR-46 A4 — `FE-W52`. The notice every MR reads must not deny what the app records, and
 * must not claim more than it records.
 *
 * Both directions are asserted on CONTENT, and each detector is first run against the
 * wording MR-45 found live, as a positive control: a detector that matches nothing would
 * pass any notice at all.
 */

interface Notice {
  readonly preamble: string;
  readonly entries: readonly TransparencyEntry[];
  readonly never: string;
}

const current: Notice = {
  preamble: TRANSPARENCY_PREAMBLE,
  entries: TRANSPARENCY_ENTRIES,
  never: NEVER_RECORDED,
};

/** The notice as it stood until MR-46 — verbatim, and false. */
const falseVersion: Notice = {
  preamble:
    'Right now this app records nothing new about you. It reads your plan and your doctor list, and that is all. Below is what it will record when those parts are built, and what it will never record.',
  entries: [
    {
      title: 'Where you are, during your shift',
      detail: 'Start day to End day. Never outside those hours.',
      state: 'not-yet',
    },
    {
      title: 'Which doctors you saw, and when',
      detail: 'Check-in and check-out times.',
      state: 'not-yet',
    },
  ],
  never:
    'Your personal calls, messages, other apps, your camera, or anything at all once your shift ends.',
};

const locationRow = (n: Notice): TransparencyEntry | undefined =>
  n.entries.find((e) => /where you are/i.test(e.title));

/** True when the notice tells the MR their location is NOT recorded. */
const deniesLocation = (n: Notice): boolean => {
  const row = locationRow(n);
  return (
    row === undefined ||
    row.state !== 'active' ||
    /records nothing/i.test(n.preamble) ||
    // "Never: where you are" denies it outright; "never: where you are between visits" does not.
    (/where you are/i.test(n.never) && !/between visits/i.test(n.never))
  );
};

/** True when any sentence claims tracking beyond the check-in and check-out moments. */
const CONTINUOUS =
  /start day to end day|during your shift|all day|throughout|continuous|every few|live location/i;
const claimsContinuousTracking = (n: Notice): boolean => {
  const row = locationRow(n);
  const text = [row?.title ?? '', row?.detail ?? ''].join(' ');
  return CONTINUOUS.test(text) || !/check-in/i.test(text) || !/check-out/i.test(text);
};

describe('FE-W52 — the transparency notice says what the code does', () => {
  it('POSITIVE CONTROL: both detectors catch the version that was live', () => {
    expect(deniesLocation(falseVersion)).toBe(true);
    expect(claimsContinuousTracking(falseVersion)).toBe(true);
  });

  it('does not deny recording location', () => {
    expect(deniesLocation(current)).toBe(false);
  });

  it('does not claim continuous tracking — only check-in and check-out', () => {
    expect(claimsContinuousTracking(current)).toBe(false);
  });

  it('says location is NOT recorded between visits, in the never block', () => {
    expect(current.never).toMatch(/between visits/i);
  });

  it('marks check-in and check-out times as recorded', () => {
    const times = current.entries.find((e) => /check-in and check-out times/i.test(e.detail));
    expect(times?.state).toBe('active');
  });

  it('marks nothing not-yet: every capture this notice names is live in this build', () => {
    // A `not-yet` row renders "this app cannot do this today". Every row below is a write
    // path that exists; adding a row for something unbuilt should fail here and be argued.
    expect(current.entries.filter((e) => e.state === 'not-yet')).toEqual([]);
  });

  it('promises no retention period the code does not enforce', () => {
    // The 90-day purge covers server audio only; reports and on-phone audio are never deleted.
    const all = [current.preamble, current.never, ...current.entries.map((e) => e.detail)];
    expect(all.filter((s) => /\b\d+ days?\b|then deleted/i.test(s))).toEqual([]);
  });

  it('no longer says nothing is recorded once the shift ends — reports and samples are', () => {
    expect(current.never).not.toMatch(/shift ends/i);
  });
});
