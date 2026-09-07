import { describe, expect, it } from 'vitest';
import { ConsentTextVersionSchema, CreateConsentRecordRequestSchema } from '@fieldforce/core';
import type { ConsentTextVersion } from '@fieldforce/core';
import {
  blockedReason,
  consentRequest,
  languageOptionsFrom,
  noticeLabelFor,
  offerableVersions,
  outcomeFor,
} from './record';

const version = (over: Partial<ConsentTextVersion> = {}): ConsentTextVersion =>
  ConsentTextVersionSchema.parse({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
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
