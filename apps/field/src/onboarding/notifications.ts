import { t } from '@fieldforce/ui/i18n';

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
  // `FE-W156`. `name` and `detail` are getters, so this constant reads the language in use.
  {
    id: 'day-plan',
    get name() {
      return t('onboarding.notifDayPlan');
    },
    get detail() {
      return t('onboarding.notifDayPlanDetail');
    },
  },
  {
    id: 'sync-outcome',
    get name() {
      return t('onboarding.notifSync');
    },
    get detail() {
      return t('onboarding.notifSyncDetail');
    },
  },
  {
    id: 'consent-outcome',
    get name() {
      return t('onboarding.notifConsent');
    },
    get detail() {
      return t('onboarding.notifConsentDetail');
    },
  },
  {
    id: 'coaching',
    get name() {
      return t('onboarding.notifCoaching');
    },
    get detail() {
      return t('onboarding.notifCoachingDetail');
    },
  },
];

/**
 * **FE-D12 item 2. The types this BUILD can send, in the design's order.** `NOTIFICATION_TYPES`
 * is the design's four. Two of them belong to switched-off features:
 * - `coaching` needs Coaching, hidden unless `coachingEnabled` (`src/features.ts`);
 * - `consent-outcome` is entirely about recordings, "a recording you made is confirmed, or
 *   consent was withdrawn", and recording is off unless `appConfig.recordingEnabled`.
 *
 * A permission screen naming a message the app cannot send asks consent for nothing real. Each
 * line follows its flag, so it returns by itself when the feature is switched on.
 */
export const notificationTypes = (build: {
  readonly coachingEnabled: boolean;
  readonly recordingEnabled: boolean;
}): readonly NotificationType[] =>
  NOTIFICATION_TYPES.filter(
    (type) =>
      (type.id !== 'coaching' || build.coachingEnabled) &&
      (type.id !== 'consent-outcome' || build.recordingEnabled),
  );

/**
 * The sentence that states the cap. One place, so the number cannot drift.
 *
 * FE-D12 item 2: the cap is one per type (see `DAILY_CAP`), so it counts the types shown. The
 * default is the design's four.
 *
 * `FE-W156`. One whole sentence per count, so a translator never has to fit "these two" into
 * somebody else's grammar.
 */
export const capSentence = (cap: number = DAILY_CAP): string => {
  switch (cap) {
    case 1:
      return t('onboarding.capOne', { cap });
    case 2:
      return t('onboarding.capTwo', { cap });
    case 3:
      return t('onboarding.capThree', { cap });
    case 4:
      return t('onboarding.capFour', { cap });
    default:
      return t('onboarding.capMany', { cap });
  }
};
