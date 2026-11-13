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

import { t } from '@fieldforce/ui/i18n';
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
  /**
   * The phone's own name for its skin, shown over the headline because the MR's phone uses it.
   * `FE-W192`: empty for the generic screen, which shows none — "Android" there read as a debug
   * label, and naming the platform tells an MR nothing they did not know.
   */
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

const XIAOMI = (): OemContent => ({
  family: 'xiaomi',
  screen: 'A5',
  skin: 'MIUI / HyperOS',
  headline: t('onboarding.xiaomiHeadline'),
  consequence: t('onboarding.xiaomiConsequence'),
  steps: [
    { intentId: 'xiaomi-autostart', title: t('onboarding.screenAutostart') },
    {
      intentId: 'xiaomi-battery',
      title: t('onboarding.stepXiaomiBattery'),
      whatYouWillSee: t('onboarding.seeXiaomiBattery'),
    },
    { title: t('onboarding.stepLockRecents') },
  ],
});

const OPPO = (): OemContent => ({
  family: 'oppo',
  screen: 'A6',
  skin: 'ColorOS',
  headline: t('onboarding.oppoHeadline'),
  consequence: t('onboarding.oppoConsequence'),
  steps: [
    { intentId: 'oppo-autostart', title: t('onboarding.screenAutoLaunch') },
    {
      intentId: 'oppo-battery',
      title: t('onboarding.stepOppoBattery'),
      whatYouWillSee: t('onboarding.seeOppoBattery'),
    },
    { title: t('onboarding.stepOppoSleep') },
  ],
});

const VIVO = (): OemContent => ({
  family: 'vivo',
  screen: 'A7',
  skin: 'Funtouch OS',
  headline: t('onboarding.vivoHeadline'),
  consequence: t('onboarding.vivoConsequence'),
  steps: [
    { intentId: 'vivo-autostart', title: t('onboarding.screenAutoStartVivo') },
    {
      intentId: 'vivo-battery',
      title: t('onboarding.stepVivoBattery'),
      whatYouWillSee: t('onboarding.seeVivoBattery'),
    },
    { title: t('onboarding.stepLockRecents') },
  ],
});

const REALME = (): OemContent => ({
  family: 'realme',
  screen: 'A8',
  skin: 'Realme UI',
  headline: t('onboarding.realmeHeadline'),
  consequence: t('onboarding.realmeConsequence'),
  // Two steps, because the extract says "two settings". Their titles are the two
  // settings A6 names, which Realme UI inherits from ColorOS. No `whatYouWillSee` on
  // either: the extract does not give Realme's wording and guessing it would defeat
  // the point of the line, which is to confirm the MR is on the right screen.
  steps: [
    { intentId: 'realme-autostart', title: t('onboarding.screenAutoLaunch') },
    { intentId: 'realme-battery', title: t('onboarding.stepRealmeBattery') },
  ],
});

/**
 * The generic screen, for the majority of devices.
 *
 * Deliberately plainer than the four: it makes no claim about what the MR's phone
 * calls these settings, because it does not know. Naming a screen that is not there
 * is the same failure as sending a Realme user to ColorOS instructions.
 */
const UNKNOWN = (): OemContent => ({
  family: 'unknown',
  screen: '—',
  skin: '',
  headline: t('onboarding.genericHeadline'),
  consequence: t('onboarding.genericConsequence'),
  steps: [
    {
      intentId: 'unknown-battery',
      title: t('onboarding.stepGenericBattery'),
      whatYouWillSee: t('onboarding.seeGenericBattery'),
    },
    {
      intentId: 'unknown-app-details',
      title: t('onboarding.stepGenericStart'),
      whatYouWillSee: t('onboarding.seeGenericStart'),
    },
  ],
});

/**
 * `FE-W156`. Builders, not objects, so the words are read in the language in use each time a
 * screen asks for them — never frozen at the moment this module loaded.
 */
const CONTENT: Readonly<Record<OemFamily, () => OemContent>> = {
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
export const contentFor = (family: OemFamily): OemContent => CONTENT[family]();
