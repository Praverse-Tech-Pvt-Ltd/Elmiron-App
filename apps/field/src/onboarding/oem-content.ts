/**
 * The words on screens A5-A8, kept as data so they can be reviewed as copy.
 *
 * **Source.** `docs/design/` is not present in this repository — the four Phase
 * documents were never committed. This copy is transcribed from the FE-W3 prompt's
 * extract of *Phase 2, "The four that get skipped"*, verbatim where the extract gives
 * a sentence.
 *
 * **Where the extract is silent, nothing is invented.** A8's numbered steps are not
 * in it. Its two step titles below are taken from the extract's own statements —
 * "two settings, same screen" and Realme's shared ColorOS lineage, whose settings A6
 * names — and A8's steps therefore carry **no `whatYouWillSee` line**, because that
 * text would be fabricated. See `A8_STEP_DETAIL_IS_UNSOURCED`.
 *
 * Copy lives here rather than inside the component for the ordinary reason: a
 * reviewer who needs to check the consequence line against the design should not have
 * to read JSX to find it.
 */

import type { OemFamily } from './oem';

export interface SetupStep {
  /** Matches a `SettingsIntent.id` when this step has a shortcut. */
  readonly intentId?: string;
  readonly title: string;
  /**
   * The design's "What you'll see" line — what the vendor's own screen says, so the
   * MR can tell they are in the right place when the wording does not match ours.
   *
   * Optional only because A8's is not in the source extract. Every step that has one
   * in the design has one here.
   */
  readonly whatYouWillSee?: string;
}

export interface OemContent {
  readonly family: OemFamily;
  /** "A5", for cross-referencing the design. Shown to nobody. */
  readonly screen: string;
  readonly skin: string;
  readonly headline: string;
  /**
   * What happens to the MR's own work if they skip this. The design puts a
   * consequence on every one of these screens, and it is always about their day —
   * check-ins, mileage, entering things by hand — never about the company's data.
   */
  readonly consequence: string;
  readonly steps: readonly SetupStep[];
}

/**
 * A8's step detail is derived, not transcribed. Exported so a test can assert the gap
 * stays visible rather than being quietly filled in with plausible-sounding text.
 */
export const A8_STEP_DETAIL_IS_UNSOURCED = true;

const XIAOMI: OemContent = {
  family: 'xiaomi',
  screen: 'A5',
  skin: 'MIUI / HyperOS',
  headline: 'Xiaomi will shut this app off. Two taps stops it.',
  consequence:
    "If MIUI closes the app, your check-ins and mileage stop and you'll be entering them by hand.",
  steps: [
    { intentId: 'xiaomi-autostart', title: 'Autostart' },
    {
      intentId: 'xiaomi-battery',
      title: 'Battery saver → No restrictions',
      whatYouWillSee: 'Battery saver / No restrictions. Tap the last one, then press back.',
    },
    { title: 'Lock the app in Recents' },
  ],
};

const OPPO: OemContent = {
  family: 'oppo',
  screen: 'A6',
  skin: 'ColorOS',
  headline: 'ColorOS is the strictest of the four.',
  consequence:
    'Three settings in three different places. Worth doing once — otherwise the app dies in your pocket within the hour.',
  steps: [
    { intentId: 'oppo-autostart', title: 'Auto-launch' },
    {
      intentId: 'oppo-battery',
      title: 'Power saving → Allow background',
      whatYouWillSee: 'Smart power saving / Allow background activity',
    },
    { title: 'Sleep standby optimisation → off' },
  ],
};

const VIVO: OemContent = {
  family: 'vivo',
  screen: 'A7',
  skin: 'Funtouch OS',
  headline: "Vivo hides this under 'High background power'.",
  consequence:
    "The setting sounds like a warning. It isn't — it's permission to keep running while you walk between clinics.",
  steps: [
    { intentId: 'vivo-autostart', title: 'Auto-start' },
    {
      intentId: 'vivo-battery',
      title: 'Allow high background power',
      whatYouWillSee: 'High background power use. Switch it on, then press back twice.',
    },
    { title: 'Lock the app in Recents' },
  ],
};

const REALME: OemContent = {
  family: 'realme',
  screen: 'A8',
  skin: 'Realme UI',
  headline: 'Two settings, same screen. Quickest of the four.',
  consequence:
    "Realme puts both in one place. Tap through and you're done in about fifteen seconds.",
  // Two steps, because the extract says "two settings". Their titles are the two
  // settings A6 names, which Realme UI inherits from ColorOS. No `whatYouWillSee` on
  // either: the extract does not give Realme's wording and guessing it would defeat
  // the point of the line, which is to confirm the MR is on the right screen.
  steps: [
    { intentId: 'realme-autostart', title: 'Auto-launch' },
    { intentId: 'realme-battery', title: 'Allow background activity' },
  ],
};

/**
 * The generic screen, for the majority of devices.
 *
 * Deliberately plainer than the four: it makes no claim about what the MR's phone
 * calls these settings, because it does not know. Naming a screen that is not there
 * is the same failure as sending a Realme user to ColorOS instructions.
 */
const UNKNOWN: OemContent = {
  family: 'unknown',
  screen: '—',
  skin: 'Android',
  headline: 'Stop Android putting this app to sleep.',
  consequence:
    "If the phone sleeps the app, your check-ins and mileage stop and you'll be entering them by hand.",
  steps: [
    {
      intentId: 'unknown-battery',
      title: 'Allow the app to run in the background',
      whatYouWillSee: 'Battery optimisation. Find this app in the list and allow it.',
    },
    {
      intentId: 'unknown-app-details',
      title: 'Check the app is allowed to start on its own',
      whatYouWillSee: 'App info. The wording differs by phone.',
    },
  ],
};

const CONTENT: Readonly<Record<OemFamily, OemContent>> = {
  xiaomi: XIAOMI,
  oppo: OPPO,
  vivo: VIVO,
  realme: REALME,
  unknown: UNKNOWN,
};

/**
 * The screen content for a family. Total — every family has content, so a detection
 * result can always be rendered and there is no "no screen for this device" branch.
 */
export const contentFor = (family: OemFamily): OemContent => CONTENT[family];
