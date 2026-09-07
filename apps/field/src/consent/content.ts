import type { ConsentDetailItem, ConsentFact, ConsentVariant } from '@fieldforce/ui';

/**
 * Phase 3's words, and the one place they are written.
 *
 * > **READ THIS BEFORE CHANGING A SENTENCE BELOW.**
 * >
 * > Everything in this file is **app-authored framing around a notice the server
 * > owns**. The thing the doctor legally agrees to is
 * > `ConsentTextVersion.fullText`, fetched per visit and rendered verbatim on the
 * > same screen. These sentences summarise it.
 * >
 * > **A summary that disagrees with the notice makes the consent record attest to
 * > something the doctor was not shown.** `consent-content.test.ts` checks the
 * > claims below against the notice the mock serves, which catches drift on this
 * > side. It cannot catch a notice changed on the server — no client can. That gap
 * > is recorded in `docs/fe-w3-spec.md` and needs a content-review process, not
 * > more code.
 *
 * **Why the copy is a function of the rep's name.** "Asked by Rahul More, Elmiron"
 * is on every variant and the name is inside the sentences too. The design's
 * reason: a doctor asked to consent by a company logo is being asked by nobody;
 * asked by the person standing in front of them, they know who to tell if they
 * change their mind — which is also the withdrawal route the notice names.
 *
 * **The rep is "they", never "he".** The design is written around one named man
 * and its copy says "his team reviews how he presented". Substituting the real
 * name into that sentence produced "Audio is recorded until Ananya stops it. His
 * team reviews how he presented" on the first run against real data — the app
 * misgendering its own user, on the one screen a stranger is reading. Nothing here
 * knows a rep's pronouns and `user_profiles` carries no field for them, so the
 * copy uses they/their throughout and reads correctly for everyone.
 */

/**
 * Which variant ships.
 *
 * **C, because the design says to test it first and gives the reason.** The failure
 * mode that actually voids consent is not an unreadable notice — it is a doctor who
 * understood perfectly and agreed anyway because declining felt rude with a rep
 * standing two feet away. `columns` is the only variant that spends half its screen
 * describing what happens when you say no.
 *
 * The other two are built, exported and tested. Changing this constant is the whole
 * of switching, because there is no experiment framework in this app to switch it
 * per-visit and inventing one to hold a single value would be the wrong order of
 * work.
 *
 * **When this is measured, the number that matters is the decline rate.** A variant
 * that produces near-total consent is not a good result; it is evidence the screen
 * is applying pressure. A healthy consent screen produces real refusals.
 */
export const CONSENT_VARIANT: ConsentVariant = 'columns';

/** How long a recording is kept. Stated in the notice; restated here, and checked. */
export const RETENTION_DAYS = 90;

export interface ConsentCopy {
  readonly question: string;
  readonly summary: string;
  readonly facts: readonly ConsentFact[];
  readonly ifAgree: string;
  readonly ifDecline: string;
}

/**
 * The face of the screen, for one named rep.
 *
 * `firstName` and not the full name inside the sentences: the doctor is being asked
 * by a person in the room, and a surname repeated four times reads as a form.
 */
export const consentCopy = (firstName: string): ConsentCopy => ({
  question: 'May we record this conversation?',

  summary: `May we record this conversation, so ${firstName}'s team can review how they presented?`,

  facts: [
    {
      heading: 'What',
      detail: `Audio of what we say, from now until ${firstName} stops it.`,
    },
    {
      heading: 'Why',
      // The single line most likely to move the decline rate, and it is true per
      // the pipeline: the analysis is of the rep. The unspoken fear in the room is
      // prescriber surveillance, and this is the sentence that answers it.
      detail: `To review how ${firstName} presents. Not to assess you.`,
    },
    {
      heading: 'How long',
      detail: `${String(RETENTION_DAYS)} days, then deleted automatically.`,
    },
    {
      heading: 'Changing your mind',
      detail: `Tell ${firstName} at any time, and it is deleted.`,
    },
  ],

  ifAgree: `Audio is recorded until ${firstName} stops it, kept ${String(RETENTION_DAYS)} days, then deleted. Their team reviews how they presented — nothing about you is assessed, and nothing about your patients is kept.`,

  // Half the screen, describing the ordinary outcome. Every clause here is a fact
  // the schema backs: `ConsentOutcomeSchema` has three equal values, the database
  // carries no penalty flag, and the visit completes the same way either way.
  ifDecline: `Nothing is recorded and the visit carries on exactly as it would have. It counts against ${firstName} in no way at all, and you will not be asked again today.`,
});

/**
 * D3's list, and it leads with what is never held.
 *
 * Every "never" below is a property of the schema rather than a promise the copy is
 * making on its own: `doctors` carries no prescribing or patient column at all —
 * the migration's own comment calls adding one "a UCPMP Cl.8 problem, not a schema
 * decision" — and there is no video anywhere in the contract.
 */
export const NEVER_COLLECTED =
  'Anything about your patients. Anything about what you prescribe. Video. Anything after the recording is stopped.';

export const consentDetails = (firstName: string): readonly ConsentDetailItem[] => [
  {
    title: 'Audio of this conversation',
    detail: `Recorded on this phone and uploaded to ${firstName}'s company. Kept ${String(RETENTION_DAYS)} days, then deleted.`,
  },
  {
    title: 'Your name and clinic',
    detail: 'Already held as a business contact, to link this visit to.',
  },
  { title: 'Date, time and duration' },
  {
    title: 'A written transcript',
    detail:
      'Made from the audio. Anything that could identify a patient is removed before anyone reads it.',
  },
];

/**
 * Who the Data Fiduciary is and where a complaint goes.
 *
 * **The company name is not hard-coded here, and today nothing can supply it.**
 * `GetMeResponse` carries a profile and visible territory ids; `Territory` carries
 * an `organisationId` and no name; there is no organisations path in `API_PATHS`
 * at all. So the app knows which organisation the MR belongs to and cannot say
 * what it is called.
 *
 * The first version of this line filled the gap with "Your rep's company", which
 * read on the emulator exactly like what it was — a placeholder, on the sentence
 * that tells a doctor who holds their data. The fallback now names the rep, who
 * *is* known and is standing in the room: "Ananya's employer is the Data
 * Fiduciary" is both true and something the doctor can act on, and it is the same
 * withdrawal route the notice itself points at.
 *
 * `organisation` stays first because the moment an endpoint returns the registered
 * name, that name is the right thing to print and this becomes a one-line change.
 */
export const fiduciaryNote = (organisation: string | null, repFirstName: string): string => {
  const who = organisation ?? `${repFirstName}'s employer`;
  return `${who} is the Data Fiduciary for this recording. A complaint can be made to the Data Protection Board of India.`;
};

/**
 * The languages this app can put a name to.
 *
 * Only used to label a code the **server** has already said it has a notice in — the
 * list of offered languages comes from `listConsentTextVersions`, never from here.
 * A tag with no entry falls back to the tag itself, which is ugly and correct: an
 * unlabelled option is better than a wrong label on a consent screen.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  'en-IN': 'English',
  'hi-IN': 'हिंदी',
  'mr-IN': 'मराठी',
  'bn-IN': 'বাংলা',
  'ta-IN': 'தமிழ்',
  'te-IN': 'తెలుగు',
  'gu-IN': 'ગુજરાતી',
  'kn-IN': 'ಕನ್ನಡ',
};

export const languageName = (tag: string): string => LANGUAGE_NAMES[tag] ?? tag;
