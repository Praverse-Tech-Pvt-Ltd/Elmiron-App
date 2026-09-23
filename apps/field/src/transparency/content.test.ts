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

  it('marks only consultation recordings not-yet: the one capture the app cannot make today', () => {
    // A `not-yet` row renders "this app cannot do this today". MR-47 measured on the Pixel 10
    // that a consultation recording cannot start, before or after consent; every other row is a
    // write path that exists. A second `not-yet` row should fail here and be argued.
    expect(current.entries.filter((e) => e.state === 'not-yet').map((e) => e.title)).toEqual([
      'Recordings — only if a doctor agrees',
    ]);
  });

  it('promises no retention period the code does not enforce', () => {
    // The 90-day purge covers server audio only; reports and on-phone audio are never deleted.
    const all = [current.preamble, current.never, ...current.entries.map((e) => e.detail)];
    expect(all.filter((s) => /\b\d+ days?\b|then deleted/i.test(s))).toEqual([]);
  });

  it('says a SAVED voice note is kept and a discarded one is deleted — MR-50 D, emulator', () => {
    const note = current.entries.find((e) => /voice notes/i.test(e.title));
    expect(note?.detail).toMatch(/saved on this phone when you press save/i);
    expect(note?.detail).toMatch(/start again or leave without saving is deleted/i);
    // The MR-47 line said the opposite; asserted absent so it cannot come back.
    expect(note?.detail).not.toMatch(/including a note you start again/i);
  });

  it('says a saved note is SENT, and removed from the phone afterwards — MR-51 D', () => {
    const note = current.entries.find((e) => /voice notes/i.test(e.title));
    expect(note?.detail).toMatch(/sent to the company/i);
    expect(note?.detail).toMatch(/waits and sends later/i);
    expect(note?.detail).toMatch(/removed from this phone/i);
    // The claim the upload made false. Asserted absent so the draft cannot drift back to it.
    expect(note?.detail).not.toMatch(/not sent to anyone yet|sending is not built/i);
  });

  it('names the purpose: review for SOP adherence, stated as monitoring (C8)', () => {
    expect(current.preamble).toMatch(/procedures \(SOPs\)/);
    expect(current.preamble).toMatch(/monitoring of your work/i);
    // Every audio row says what review it is kept for.
    for (const title of [/voice notes/i, /recordings/i]) {
      const row = current.entries.find((e) => title.test(e.title));
      expect(row?.detail).toMatch(/reviewed for how procedures are followed/i);
    }
  });

  it('does not claim the AI review already happens — it is not built', () => {
    expect(current.preamble).toMatch(/AI system once that is built/i);
  });

  it('no longer says nothing is recorded once the shift ends — reports and samples are', () => {
    expect(current.never).not.toMatch(/shift ends/i);
  });
});
