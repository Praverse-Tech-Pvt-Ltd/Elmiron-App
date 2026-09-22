import type { TransparencyEntry } from '@fieldforce/ui';

/**
 * A9 — "Everything, before you ask."
 *
 * ---
 * **MR-46 — `FE-W52`. THIS WORDING IS A DRAFT AWAITING THE OPERATOR (`blocked-on-you` 2.6).**
 *
 * The version it replaces told every MR that the app "records nothing new about you" and
 * marked check-ins and location `not-yet`. Both have been recorded since MR-18: check-in and
 * check-out reach `record_check_in` / `record_check_out` through `sync_push`, and each row
 * stores latitude, longitude, accuracy, distance from the clinic and inside/outside the
 * geofence. Call reports and samples reach Supabase too.
 *
 * Every sentence below was checked against the code, not against the design:
 *
 * - **Location** — `src/capture/location.ts` takes a fix only when `takeFix` is called, and
 *   its only recording caller is check-in / check-out in `app/visit/[id].tsx`. The
 *   onboarding "Turn location on" button also reads a position, and discards it. No
 *   watcher, no background permission in the manifest. So: at check-in and check-out, and
 *   NOT between visits. The old "Start day to End day" would overstate it the other way.
 * - **Reports and samples** — `apply_sync_item`'s `call_report` and `sample_and_input`
 *   branches. Managers read reports through `visible_user_ids()`. Nothing deletes either,
 *   so no retention period is promised for them.
 * - **MR-50 G, 22 September 2026 — redrafted for `C8` and `C9`.** Voice notes are KEPT (`C9`): a saved
 *   note moves to the rep's own folder, and a discarded one is deleted (MR-50 D, emulator). The
 *   audio's recorded PURPOSE (`C8`) is review for SOP adherence — employee monitoring — so the
 *   preamble says so in plain words, and each audio row says what review it is kept for.
 * - **Voice notes** (before MR-50) — audio is captured on the phone; the metadata goes to the mock and the
 *   bytes go nowhere (no upload client). So they are "kept on this phone", and the 90-day
 *   purge, which covers server audio only, is not promised for them. **MR-47, measured on the
 *   Pixel 10:** a note the MR discards with "Start again" stays in `cache/Audio` too (`FE-W53`).
 * - **Consultation recordings — `not-yet`, and truly so (MR-47).** MR-46 marked this row
 *   active from code. On the device the record control never appears, before or after the
 *   doctor consents: the visit screen's consent list is a hard-coded empty array.
 * - **Never** — the manifest requests no camera, SMS, contacts, call-log or usage-stats
 *   permission. The old "anything at all once your shift ends" was dropped: the server
 *   refuses a check-in or check-out outside the shift window, but accepts reports and
 *   samples at any hour.
 *
 * The design doc (`docs/design/phase2-first-run-and-the-day.dc.html` §A9) is no longer the
 * source for this copy. It describes a product; this describes the build.
 * ---
 */
export const NEVER_RECORDED =
  'Your personal calls, messages, other apps or camera. Where you are between visits.';

export const TRANSPARENCY_PREAMBLE =
  'This app records your work visits: when you check in and check out, where you were at those two moments, what you report and the samples you give. It does not follow you between visits. What it records is kept so your visits can be reviewed — by your manager, and by an AI system once that is built — to check that the company’s procedures (SOPs) are followed. That is monitoring of your work, and each item it covers is below.';

export const TRANSPARENCY_ENTRIES: readonly TransparencyEntry[] = [
  {
    title: 'Where you are — only when you check in or check out',
    detail:
      'Your position at the moment you press check-in and check-out, and how far that is from the clinic. Nothing between visits, and nothing in the background.',
    state: 'active',
  },
  {
    title: 'Which doctors you saw, and when',
    detail: "Check-in and check-out times, and whether you were inside the clinic's area.",
    state: 'active',
  },
  {
    title: 'Your call reports',
    detail: 'What you write after a visit. Your manager can read them.',
    state: 'active',
  },
  {
    title: 'Samples and inputs you give',
    detail: 'The item, the quantity, its value, the doctor and the time.',
    state: 'active',
  },
  {
    title: 'Your voice notes',
    detail:
      'Kept on this phone when you save one; a note you start again or leave without saving is deleted. Not sent to anyone yet — sending is not built. Once it is, saved notes are reviewed for how procedures are followed.',
    state: 'active',
  },
  {
    title: 'Recordings — only if a doctor agrees',
    detail:
      'When recording is built, a consultation is recorded only after the doctor agrees, and is reviewed for how procedures are followed. If they say no, nothing happens to you.',
    state: 'not-yet',
  },
];
