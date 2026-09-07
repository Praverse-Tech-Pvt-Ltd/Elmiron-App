import { CreateConsentRecordRequestSchema } from '@fieldforce/core';
import type {
  ConsentOutcome,
  ConsentTextVersion,
  CreateConsentRecordRequest,
} from '@fieldforce/core';
import type { ConsentAnswer, ConsentLanguageOption } from '@fieldforce/ui';
import { languageName } from './content';

/**
 * The consent handoff's arithmetic, away from the renderer.
 *
 * Everything here is about one thing: **a consent record must be able to prove what
 * was on the screen.** `ConsentRecord` carries `consentTextVersionId` and
 * `displayedLanguage` for exactly that, and `ConsentTextVersion` carries a
 * SHA-256 of its own text so a later audit can tell whether the text was altered.
 * None of that survives a client that picks a version id casually.
 */

/**
 * Which notice versions may be offered, in a stable order.
 *
 * A version whose `effectiveUntil` has passed is not offered, ever. The field
 * exists because a notice can be superseded, and showing a doctor a retired notice
 * produces a record that attests to text the company has already replaced.
 *
 * Compared as text rather than as `Date`: these are contract ISO-8601 with an
 * offset, and parsing them re-expresses them in the handset's timezone — the same
 * rule `today/plan.ts` follows, and here it decides whether a legal document is
 * still in force.
 */
export const offerableVersions = (
  versions: readonly ConsentTextVersion[],
  nowIso: string,
): readonly ConsentTextVersion[] =>
  versions
    .filter((version) => version.effectiveFrom <= nowIso)
    .filter((version) => version.effectiveUntil === null || version.effectiveUntil > nowIso);

/**
 * One option per language, labelled, in the order the server sent them.
 *
 * Deduplicated by language because a language with two live versions is a server
 * condition this screen cannot resolve — it offers the language once and lets
 * `getActiveConsentText` decide which version is the active one, which is the only
 * place that decision belongs.
 */
export const languageOptionsFrom = (
  versions: readonly ConsentTextVersion[],
): readonly ConsentLanguageOption[] => {
  const seen = new Set<string>();
  const options: ConsentLanguageOption[] = [];
  for (const version of versions) {
    if (seen.has(version.language)) continue;
    seen.add(version.language);
    options.push({ code: version.language, label: languageName(version.language) });
  }
  return options;
};

/**
 * "Notice v1.2 · English · a1b2c3d4" — what the record will point at, on screen.
 *
 * The hash prefix is on the face of the screen rather than buried, because it is
 * the only part of this label that is checkable. A version label can be reused; the
 * hash cannot. Eight hex characters is enough to distinguish the handful of notices
 * a company has and short enough not to read as noise to a doctor.
 */
export const noticeLabelFor = (version: ConsentTextVersion): string =>
  `Notice ${version.versionLabel} · ${languageName(version.language)} · ${version.hash.slice(0, 8)}`;

/** The screen's two answers, as the ledger's outcomes. There is no third answer. */
export const outcomeFor = (answer: ConsentAnswer): ConsentOutcome => answer;

export interface ConsentRecordDraft {
  /** Device-generated. The contract's idempotency key. */
  readonly id: string;
  readonly visitId: string;
  readonly doctorId: string;
  readonly answer: ConsentAnswer;
  /** The version that was on the screen when the doctor answered. Not the latest. */
  readonly version: ConsentTextVersion;
  /** When the doctor tapped. The device clock, and correctly so — see below. */
  readonly capturedAt: string;
}

/**
 * The answer, as a contract request.
 *
 * **`capturedAt` is the device clock and that is right.** The contract pairs it
 * with a server `receivedAt`, and the moment being recorded is the moment a person
 * in a room tapped a button — a fact about that room, not about when the request
 * reached Mumbai. A consent captured offline and pushed four hours later must still
 * say when it happened.
 *
 * Parsed through the contract schema rather than merely shaped like it, so a
 * request the server would refuse fails here, on the device, while the doctor is
 * still in front of the MR.
 */
export const consentRequest = (draft: ConsentRecordDraft): CreateConsentRecordRequest =>
  CreateConsentRecordRequestSchema.parse({
    id: draft.id,
    visitId: draft.visitId,
    doctorId: draft.doctorId,
    outcome: outcomeFor(draft.answer),
    // Only ever set for `not_asked`, and this path never produces that outcome.
    // Sending a reason alongside a real answer would put a justification on a
    // decision that needs none.
    notAskedReason: null,
    consentTextVersionId: draft.version.id,
    displayedLanguage: draft.version.language,
    capturedAt: draft.capturedAt,
  });

/**
 * Why the question cannot be put, in the MR's words, or null when it can.
 *
 * **This is a hard gate and it is the most important function in the folder.** With
 * no notice there is no `consentTextVersionId`, and a consent record without one
 * cannot say what was agreed to. The screen is not shown, the doctor is not asked,
 * and the MR is told plainly rather than being handed a screen whose Yes writes an
 * unprovable row.
 */
export const blockedReason = (
  version: ConsentTextVersion | null,
  failed: boolean,
): { title: string; detail: string } | null => {
  if (version !== null) return null;
  return failed
    ? {
        title: 'The consent notice could not be loaded',
        detail:
          'Without it there is nothing to show the doctor and nothing to put on the record. Carry on with the visit — you can ask once you have signal.',
      }
    : {
        title: 'There is no consent notice for this language yet',
        detail:
          'Nobody has published one your company can stand behind. Carry on with the visit; recording is not available until there is.',
      };
};
