/**
 * A3 — what the app will send, named rather than described.
 *
 * The design's rule: A3 **names all four notification types and caps them**. "Stay
 * updated" is not an acceptable substitute, because a permission prompt that does not
 * say what it will send is asking for consent to an unbounded thing.
 *
 * ---
 * **SOURCING, AND WHERE IT IS THIN.**
 *
 * `docs/design/` is not in this repository, so Phase 2's exact four names could not be
 * read. The names below are **derived from features that demonstrably exist in this
 * codebase** rather than invented as copy:
 *
 *   1. the beat plan and visit list (`app/home.tsx`, the MR's day)
 *   2. the upload queue's verdicts (`src/sync/`, `QueueScreen`'s refused and
 *      needs-attention states)
 *   3. consent outcomes (`@fieldforce/core` → `field/consent.ts`)
 *   4. coaching (Phase 4, "Coaching and Console")
 *
 * That is a defensible mapping and it is **not the design's wording.** It must be
 * checked against Phase 2 before this screen ships. `NAMES_ARE_DERIVED` marks it so
 * the gap cannot be lost.
 *
 * The **cap is not sourced at all.** The design caps the count; the number is not in
 * the extract. `DAILY_CAP` is a placeholder in the same sense as the colour palette,
 * and is flagged the same way.
 * ---
 */

/**
 * False when these four names have been checked against Phase 2 §"First run".
 * A test asserts this stays `true` until that happens, so the screen cannot quietly
 * come to look sourced.
 */
export const NAMES_ARE_DERIVED = true;

/** Likewise unsourced. See the note above. */
export const DAILY_CAP_IS_UNSOURCED = true;

/**
 * The cap, in notifications per working day.
 *
 * Four — one per type — chosen because it is the smallest number that lets each named
 * type appear at all, which makes it the conservative placeholder rather than a
 * guess at what the design intended.
 */
export const DAILY_CAP = 4;

export interface NotificationType {
  readonly id: string;
  /** The name. Kept short enough to read as a list item on a 5-inch screen. */
  readonly name: string;
  /** One line on what triggers it, so "name" is not the only thing the MR gets. */
  readonly detail: string;
}

/**
 * Exactly four, and the type below enforces it.
 *
 * A tuple rather than an array: the design says four, and a fifth added without a
 * corresponding design change should fail the build rather than quietly appear on the
 * consent screen.
 */
export const NOTIFICATION_TYPES: readonly [
  NotificationType,
  NotificationType,
  NotificationType,
  NotificationType,
] = [
  {
    id: 'day-plan',
    name: "Your day's plan",
    detail: "When tomorrow's visits are ready, and when a manager changes them.",
  },
  {
    id: 'sync-outcome',
    name: 'Whether your work saved',
    detail: 'Only when something you sent was refused and needs you to look at it.',
  },
  {
    id: 'consent-outcome',
    name: 'Consent outcomes',
    detail: 'When a recording you made is confirmed, or when consent was withdrawn.',
  },
  {
    id: 'coaching',
    name: 'Coaching notes',
    detail: 'When your manager leaves a note on one of your visits.',
  },
];

/** The sentence that states the cap. One place, so the number cannot drift. */
export const capSentence = (cap: number = DAILY_CAP): string =>
  `At most ${String(cap)} a day, and nothing outside these four.`;
