import type { TransparencyEntry } from '@fieldforce/ui';

/**
 * A9 — "Everything, before you ask." The five rows, taken from Phase 2's own copy.
 *
 * ---
 * **SOURCING.** Unlike `src/onboarding/notifications.ts`, which was written before
 * `docs/design/` existed and had to derive its wording, these titles and details are
 * transcribed from `docs/design/phase2-first-run-and-the-day.dc.html` §A9. The
 * design is in the repository now and this file should be diffed against it, not
 * rewritten from memory.
 * ---
 *
 * **Every capture row is `not-yet`, and that is the honest state of this build.**
 *
 * - Location: the app takes no position fix at all. Whether it may is an open
 *   policy question — `fe-w3-spec.md` §4 forbids code written against an assumed
 *   answer, so there is nothing to describe.
 * - Check-in and check-out times: the contract has the endpoints; no screen calls
 *   them yet.
 * - Voice notes and recordings: FE-W4.
 *
 * A screen that listed these as things happening now would be describing a
 * capability this app does not have, on the one screen whose entire value is that
 * it does not overstate. When each lands, its row flips to `active` — and that flip
 * is the point of the field.
 */
export const NEVER_RECORDED =
  'Your personal calls, messages, other apps, your camera, or anything at all once your shift ends.';

export const TRANSPARENCY_PREAMBLE =
  'Right now this app records nothing new about you. It reads your plan and your doctor list, and that is all. Below is what it will record when those parts are built, and what it will never record.';

export const TRANSPARENCY_ENTRIES: readonly TransparencyEntry[] = [
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
  {
    title: 'Your voice notes and reports',
    detail: 'Kept 90 days, then deleted.',
    state: 'not-yet',
  },
  {
    title: 'Recordings — only if a doctor agrees',
    detail: 'If they say no, nothing happens to you.',
    state: 'not-yet',
  },
];
