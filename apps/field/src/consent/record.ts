import { CreateConsentRecordRequestSchema } from '@fieldforce/core';
import type {
  ConsentOutcome,
  ConsentTextVersion,
  CreateConsentRecordRequest,
  PulledConsentTextVersion,
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
 *
 * ---
 *
 * **MR-22 B2. "In a stable order" was a claim this function did not deliver.** It
 * filtered and returned whatever order the caller handed it, and the consent screen
 * takes `live[0].language` as the DEFAULT language to show a doctor. With one language
 * in every fixture that was deterministic by accident; MR-16 added `hi-IN` as a test
 * dimension and the default became a function of however the server happened to sort
 * `consent_text_versions`.
 *
 * That matters more than an ordinary default: `displayed_language` is derived
 * SERVER-side from the version the client sends, so the client decides it implicitly by
 * deciding which version to display. An unordered list was therefore choosing a field on
 * a compliance record.
 *
 * The sort below makes it deterministic. **It does not make it a product decision** —
 * which language an MR should be shown first is a client question, registered rather
 * than answered here. Sorting by language code is a defensible arbitrary rule and is
 * labelled as arbitrary, not dressed up as a preference.
 */
/**
 * Which version is in force for a language — **the server's answer, not a re-derivation**.
 *
 * **MR-27 B1 removed the mirror that stood here.** MR-26 B1 put the notices in the pull and
 * had this function reproduce the schema's ordering: `effective_from desc, created_at desc,
 * id desc`. Mirroring all three keys was necessary once the first version sorted on one and
 * would have disagreed with the server on any tie — but it left TWO COPIES OF ONE RULE, and
 * a disagreement between them does not fail in a test. It fails as a `45001` refusal, at
 * capture, with a doctor waiting.
 *
 * The pull now carries `precedence`, computed by `public.consent_text_version_precedence`,
 * which is also what `active_consent_text_at` orders by. **One definition, on the server.**
 *
 * **What is still decided here, and why that is right.** The effective WINDOW —
 * `effectiveFrom <= now < effectiveUntil` — stays on the client, because it depends on the
 * clock and a pull is a snapshot. A notice that becomes active tomorrow because the clock
 * passes `effective_from` does not change, so its `updated_at` does not move, so it is never
 * re-emitted; a transmitted `is_active` flag would go stale with nothing to correct it. The
 * ordering carries no clock and travels safely. The split follows what each side can know.
 *
 * Taking the LOWEST precedence among the in-force versions is equivalent to the server's
 * filter-order-limit by construction: precedence is a total order over the same keys, so the
 * minimum within a subset is that subset's first element under the ordering.
 *
 * `capture_consent` still re-resolves at `captured_at` and refuses `45001` when it disagrees
 * — and that refusal now means ONE thing. It means the notice genuinely changed between the
 * pull and the capture, which is FIX-12 working exactly as designed. While the ordering was
 * mirrored it could have meant that, or that the two sorts disagreed, and nobody — including
 * the MR holding the phone — could tell which.
 */
export const activeNoticeFor = (
  versions: readonly PulledConsentTextVersion[],
  language: string,
  nowIso: string,
): PulledConsentTextVersion | null =>
  versions
    .filter((version) => version.language === language)
    .filter((version) => version.effectiveFrom <= nowIso)
    .filter((version) => version.effectiveUntil === null || version.effectiveUntil > nowIso)
    .reduce<PulledConsentTextVersion | null>(
      (best, version) => (best === null || version.precedence < best.precedence ? version : best),
      null,
    );

export const offerableVersions = (
  versions: readonly PulledConsentTextVersion[],
  nowIso: string,
): readonly PulledConsentTextVersion[] =>
  versions
    .filter((version) => version.effectiveFrom <= nowIso)
    .filter((version) => version.effectiveUntil === null || version.effectiveUntil > nowIso)
    .slice()
    // **Language first, then the SERVER's precedence.**
    //
    // The language key decides which one an MR is offered by DEFAULT, and it is arbitrary by
    // admission -- `blocked-on-you` 5.12 is the open question of what it should be. It is
    // presentation, not selection, and `localeCompare` on the CODE rather than the display
    // name keeps it stable: the name is localised and would reorder with the device.
    //
    // Within a language it was `effectiveFrom` descending -- a third, weaker copy of the
    // ordering the server owns, which would have disagreed with `activeNoticeFor` on exactly
    // the ties MR-27 B1 removed. Using `precedence` makes the list's order and the selection
    // the same rule, so the version shown first IS the version that would be captured.
    .sort((a, b) => a.language.localeCompare(b.language) || a.precedence - b.precedence);

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
