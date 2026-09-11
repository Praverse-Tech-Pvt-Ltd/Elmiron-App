import { describe, expect, it } from 'vitest';
import { CreateConsentRecordRequestSchema, PulledConsentTextVersionSchema } from '@fieldforce/core';
import type { PulledConsentTextVersion } from '@fieldforce/core';
import {
  activeNoticeFor,
  blockedReason,
  consentRequest,
  languageOptionsFrom,
  noticeLabelFor,
  offerableVersions,
  outcomeFor,
} from './record';

const version = (over: Partial<PulledConsentTextVersion> = {}): PulledConsentTextVersion =>
  PulledConsentTextVersionSchema.parse({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    precedence: 1,
    versionLabel: 'v1.2',
    language: 'en-IN',
    fullText: 'I agree that this conversation may be audio recorded.',
    hash: 'a1b2c3d4'.repeat(8),
    effectiveFrom: '2026-07-01T00:00:00+05:30',
    effectiveUntil: null,
    createdAt: '2026-07-01T00:00:00+05:30',
    ...over,
  });

const NOW = '2026-09-03T11:58:00+05:30';

describe('a retired notice is never offered', () => {
  it('keeps a version with no end date', () => {
    expect(offerableVersions([version()], NOW)).toHaveLength(1);
  });

  it('drops a version whose effectiveUntil has passed', () => {
    // Showing a doctor a retired notice produces a record attesting to text the
    // company has already replaced. The field exists precisely for this.
    const retired = version({ effectiveUntil: '2026-08-01T00:00:00+05:30' });
    expect(offerableVersions([retired], NOW)).toHaveLength(0);
  });

  it('drops a version that is not in force yet', () => {
    const future = version({ effectiveFrom: '2027-01-01T00:00:00+05:30' });
    expect(offerableVersions([future], NOW)).toHaveLength(0);
  });

  it('keeps one whose end date is still ahead', () => {
    const ending = version({ effectiveUntil: '2026-12-01T00:00:00+05:30' });
    expect(offerableVersions([ending], NOW)).toHaveLength(1);
  });
});

describe('the language options come from the server, not from a list in the app', () => {
  it('labels each language in its own script', () => {
    const options = languageOptionsFrom([version(), version({ language: 'hi-IN' })]);
    expect(options).toEqual([
      { code: 'en-IN', label: 'English' },
      { code: 'hi-IN', label: 'हिंदी' },
    ]);
  });

  it('offers a language once even when the server has two versions of it', () => {
    const options = languageOptionsFrom([version(), version({ versionLabel: 'v1.3' })]);
    expect(options).toHaveLength(1);
  });

  it('falls back to the raw tag rather than mislabelling one it does not know', () => {
    // An unlabelled option is better than a wrong label on a consent screen.
    expect(languageOptionsFrom([version({ language: 'kok-IN' })])[0]?.label).toBe('kok-IN');
  });
});

describe('the notice label is checkable', () => {
  it('carries the version, the language and a hash prefix', () => {
    // The label can be reused between notices; the hash cannot. That is why it is
    // on the face of the screen rather than buried in an audit table.
    expect(noticeLabelFor(version())).toBe('Notice v1.2 · English · a1b2c3d4');
  });
});

describe('the answer becomes a contract request', () => {
  const draft = {
    id: '33333333-3333-4333-8333-333333333301',
    visitId: '33333333-3333-4333-8333-3333333333aa',
    doctorId: '33333333-3333-4333-8333-3333333333bb',
    capturedAt: NOW,
  };

  it.each(['consented', 'declined'] as const)(
    'sends %s down the same path, with the version that was on screen',
    (answer) => {
      const request = consentRequest({ ...draft, answer, version: version() });
      expect(() => CreateConsentRecordRequestSchema.parse(request)).not.toThrow();
      expect(request.outcome).toBe(answer);
      expect(request.consentTextVersionId).toBe(version().id);
      expect(request.displayedLanguage).toBe('en-IN');
    },
  );

  it('records the language that was displayed, not a default', () => {
    const request = consentRequest({
      ...draft,
      answer: 'consented',
      version: version({ language: 'hi-IN' }),
    });
    expect(request.displayedLanguage).toBe('hi-IN');
  });

  it('never attaches a reason to a real answer', () => {
    // `notAskedReason` belongs to the `not_asked` outcome. Putting a justification
    // on a decline would make declining the outcome that needs explaining.
    expect(
      consentRequest({ ...draft, answer: 'declined', version: version() }).notAskedReason,
    ).toBeNull();
  });

  it('maps the screen’s two answers straight onto the ledger’s outcomes', () => {
    expect(outcomeFor('consented')).toBe('consented');
    expect(outcomeFor('declined')).toBe('declined');
  });
});

describe('no notice, no question', () => {
  it('lets the question be asked once a notice is in hand', () => {
    expect(blockedReason(version(), false)).toBeNull();
  });

  it('blocks when the fetch failed, and tells the MR the visit carries on', () => {
    const blocked = blockedReason(null, true);
    expect(blocked?.title).toMatch(/could not be loaded/u);
    expect(blocked?.detail).toMatch(/Carry on with the visit/u);
  });

  it('blocks differently when nobody has published one', () => {
    // Two different situations with two different remedies: one waits for signal,
    // the other waits for a person to publish a notice.
    const blocked = blockedReason(null, false);
    expect(blocked?.title).toMatch(/no consent notice/u);
    expect(blocked?.detail).toMatch(/Carry on with the visit/u);
  });
});

/**
 * MR-22 B2 — the DEFAULT language a doctor is shown must not depend on list order.
 *
 * `app/consent/[visitId].tsx` takes `offerableVersions(...)[0].language` as the language to
 * display. `displayed_language` is then derived SERVER-side from the version the client
 * sends, so the client decides that compliance field implicitly by deciding which version
 * to show.
 *
 * With one language in every fixture this was deterministic by accident. MR-16 added
 * `hi-IN` as a test dimension and the default became a function of however the server
 * happened to sort `consent_text_versions` — an unordered list choosing a field on a
 * consent record. The doc comment claimed "in a stable order" and the code did not sort.
 */
describe('the offered order is deterministic, because a default depends on it', () => {
  const en = version({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11', language: 'en-IN' });
  const hi = version({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12', language: 'hi-IN' });

  it('gives the same first version whichever order the server sent them in', () => {
    // THE ASSERTION THAT MATTERS. Same set, two input orders, one answer -- so the
    // language a doctor is shown cannot flip between two syncs.
    const forwards = offerableVersions([en, hi], NOW);
    const backwards = offerableVersions([hi, en], NOW);
    expect(forwards[0]?.language).toBe(backwards[0]?.language);
    expect(forwards.map((v) => v.language)).toEqual(backwards.map((v) => v.language));
  });

  it('puts the NEWEST live version first within one language', () => {
    // Within a language the newest live notice is the one in force. Offering an older
    // live version first would show a doctor text the company has already moved on from,
    // even though it has not formally expired.
    //
    // MR-27 B1: the INTENT is unchanged and the mechanism moved. "Newest first" is what the
    // server's precedence MEANS -- `consent_text_version_precedence` orders by
    // `effective_from desc, created_at desc, id desc` -- so the fixtures now carry the rank
    // the server would compute, and this asserts the client honours it. The `effectiveFrom`
    // values are kept, and deliberately still point the same way, so the case reads the same
    // to a human.
    const older = version({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13',
      language: 'en-IN',
      effectiveFrom: '2026-07-01T00:00:00+05:30',
      precedence: 2,
    });
    const newer = version({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14',
      language: 'en-IN',
      effectiveFrom: '2026-08-01T00:00:00+05:30',
      precedence: 1,
    });
    expect(offerableVersions([older, newer], NOW)[0]?.id).toBe(newer.id);
    expect(offerableVersions([newer, older], NOW)[0]?.id).toBe(newer.id);
  });

  it('still filters — ordering did not replace the retirement rule', () => {
    // The positive control on the change. A sort that quietly dropped the filters would
    // pass both cases above while offering a doctor a retired notice, which is the whole
    // reason this function exists.
    const retired = version({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15',
      language: 'hi-IN',
      effectiveUntil: '2026-08-01T00:00:00+05:30',
    });
    const offered = offerableVersions([en, retired], NOW);
    expect(offered).toHaveLength(1);
    expect(offered[0]?.id).toBe(en.id);
  });

  it('asserts its own precondition: the fixture really does hold two languages', () => {
    // If this ever collapsed to one language the ordering cases would pass trivially and
    // the guard would be back to proving nothing -- MR-16's finding, applied to itself.
    expect(new Set([en.language, hi.language]).size).toBe(2);
  });
});

describe('MR-27 B1: activeNoticeFor uses the SERVER precedence, not a mirrored sort', () => {
  const version = (over: Partial<PulledConsentTextVersion> = {}): PulledConsentTextVersion => ({
    id: '11111111-1111-4111-8111-111111111111',
    versionLabel: 'v1',
    language: 'en-IN',
    fullText: 'text',
    hash: 'a'.repeat(64),
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    effectiveUntil: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    precedence: 1,
    ...over,
  });

  const NOW = '2026-09-11T12:00:00.000Z';

  it('picks precedence 1, whatever the other fields say', () => {
    // **The case that would have caught the original defect.** `effectiveFrom` deliberately
    // points the OTHER WAY: the row the server ranks first is the OLDER one. A client that
    // still sorted by `effectiveFrom desc` would pick the wrong version here and meet 45001
    // in front of a doctor. Only obeying the transmitted rank gets this right.
    const serverPicks = version({
      id: '11111111-1111-4111-8111-111111111111',
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      precedence: 1,
    });
    const newerButRankedSecond = version({
      id: '22222222-2222-4222-8222-222222222222',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      precedence: 2,
    });
    expect(activeNoticeFor([newerButRankedSecond, serverPicks], 'en-IN', NOW)?.id).toBe(
      serverPicks.id,
    );
  });

  it('does not cross languages — the clause MR-16 made falsifiable', () => {
    const english = version({ id: '11111111-1111-4111-8111-111111111111', language: 'en-IN' });
    const hindi = version({
      id: '22222222-2222-4222-8222-222222222222',
      language: 'hi-IN',
      precedence: 1,
    });
    expect(activeNoticeFor([english, hindi], 'en-IN', NOW)?.id).toBe(english.id);
    expect(activeNoticeFor([english, hindi], 'hi-IN', NOW)?.id).toBe(hindi.id);
  });

  it('applies the TIME WINDOW on the client, which is the half the server cannot snapshot', () => {
    // Precedence carries no clock. A notice ranked 1 that is RETIRED must not be offered, and
    // the server cannot have told us that at pull time -- `effective_until` passing moves
    // nothing, so the row is never re-emitted. This is why the split is a rank and not an
    // `is_active` flag.
    const retired = version({ precedence: 1, effectiveUntil: '2026-09-01T00:00:00.000Z' });
    const live = version({
      id: '22222222-2222-4222-8222-222222222222',
      precedence: 2,
    });
    expect(activeNoticeFor([retired, live], 'en-IN', NOW)?.id).toBe(live.id);
  });

  it('excludes one that is not yet in force, however it is ranked', () => {
    const future = version({ precedence: 1, effectiveFrom: '2026-12-01T00:00:00.000Z' });
    expect(activeNoticeFor([future], 'en-IN', NOW)).toBeNull();
  });

  it('THE POSITIVE CONTROL: an empty list is null, not a throw and not a guess', () => {
    // Without this, "return the first thing you find" would satisfy every case above. An
    // empty store is a real state -- a fresh install that has not synced -- and it must
    // produce the "no notice" wording rather than an exception in front of a doctor.
    expect(activeNoticeFor([], 'en-IN', NOW)).toBeNull();
  });

  it('offerableVersions orders WITHIN a language by precedence too', () => {
    // So the version shown first IS the version that would be captured. Within-language
    // ordering was a third copy of the server rule and is now the same one.
    const first = version({ id: '11111111-1111-4111-8111-111111111111', precedence: 2 });
    const second = version({ id: '22222222-2222-4222-8222-222222222222', precedence: 1 });
    const ordered = offerableVersions([first, second], NOW);
    expect(ordered[0]?.id).toBe(second.id);
    expect(activeNoticeFor(ordered, 'en-IN', NOW)?.id).toBe(ordered[0]?.id);
  });
});
