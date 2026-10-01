import type { TransparencyEntry } from '@fieldforce/ui';

/**
 * A9 — "Everything, before you ask." The design's structure and voice
 * (`docs/design/phase2-first-run-and-the-day.dc.html` §A9), stating what THIS BUILD records.
 *
 * **FE-D12 item 1. Every row is now a fact about the code, and each is cited in the FE-D12 section
 * of `PROJECT-OVERVIEW.md`, not here and not on screen.** The rows were written in FE-W3, when
 * nothing was captured, as `not-yet` with a preamble saying the app "records nothing new about
 * you". Check-ins, positions, samples, reports and voice notes all landed after that, and the
 * screen kept saying the opposite. `content.test.ts` now reads the capturing routes and fails if a
 * row calls a wired capture "not yet".
 *
 * **Where this departs from the design's copy, the design was describing a different product:**
 * - "Where you are, during your shift · Start day to End day" describes continuous tracking.
 *   This build takes ONE fix per check-in or check-out press, and none at any other time.
 * - "Kept 90 days, then deleted" -- what the server does is stamp `purge_after` 90 days from
 *   receipt on every voice note. Deletion depends on the purge job running, so the row says
 *   "marked for deletion".
 * - "anything at all once your shift ends" is not something this client enforces, so it is not
 *   claimed. What is claimed is what the APK holds no permission for.
 *
 * There is no preamble any more. It existed to say "none of the list below is built yet", and the
 * list now says what is recorded.
 *
 * Copy is factually accurate but needs privacy/legal review; no owner named.
 */
export const NEVER_RECORDED =
  'Your calls, messages, contacts, camera or other apps: this app has no permission to reach them. And nothing in the background: your position is read only at the moment you press check in or check out.';

export const transparencyEntries = (build: {
  readonly recordingEnabled: boolean;
}): readonly TransparencyEntry[] => [
  {
    title: 'Where you are, when you check in or out',
    detail:
      'One position each time you press check in or check out, and how far that was from the clinic. Never in the background, never between visits.',
    state: 'active',
  },
  {
    title: 'Which doctors you saw, and when',
    detail: 'Check-in and check-out times.',
    state: 'active',
  },
  {
    title: 'Your voice notes',
    detail:
      'Only while you hold the button. Marked for deletion 90 days after they reach your company.',
    state: 'active',
  },
  {
    title: 'Your reports, and what you left',
    detail: 'The call reports you send and the samples you record, in your words.',
    state: 'active',
  },
  {
    title: 'Recordings — only if a doctor agrees',
    detail: 'Only after the doctor agrees on screen, each time.',
    state: build.recordingEnabled ? 'active' : 'not-yet',
  },
];

/** This build: consultation recording is off unless the build sets it (`config.ts:34`). */
export const TRANSPARENCY_ENTRIES: readonly TransparencyEntry[] = transparencyEntries({
  recordingEnabled: false,
});
