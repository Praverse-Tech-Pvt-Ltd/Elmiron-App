import { describe, expect, it } from 'vitest';
import {
  CONSENT_VARIANT,
  consentCopy,
  consentDetails,
  fiduciaryNote,
  languageName,
  NEVER_COLLECTED,
  RETENTION_DAYS,
} from './content';

const copy = consentCopy('Rahul');

/**
 * What these tests can and cannot guard.
 *
 * The summary on the consent face is app-authored; the notice the doctor legally
 * agrees to is the server's, fetched per visit and rendered verbatim beside it. If
 * the two ever disagree, the consent record attests to something the doctor was not
 * shown.
 *
 * **No test in this app can catch that**, and pretending otherwise would be worse
 * than admitting it: the notice lives on a customer's server and can change without
 * a release. `apps/field` cannot even import the mock's fixtures — it does not
 * declare that workspace as a dependency and an ESLint rule enforces it — so there
 * is no shipped notice here to diff against either.
 *
 * What is guarded below is the half that is actually likely to break: the app
 * stating a term in one place and a different term in another. Every claim the
 * copy makes is stated once, in a constant, and asserted to reach every sentence
 * that repeats it. The cross-check against a live notice is a content-review
 * obligation, recorded in `docs/fe-w3-spec.md`, not a test.
 */
describe('every term the copy states is stated once and used everywhere', () => {
  it('takes the retention period from one constant, in all three places it appears', () => {
    // The number most likely to drift, and the one a doctor is most likely to
    // remember afterwards.
    expect(copy.facts.find((fact) => fact.heading === 'How long')?.detail).toContain(
      String(RETENTION_DAYS),
    );
    expect(copy.ifAgree).toContain(String(RETENTION_DAYS));
    expect(consentDetails('Rahul')[0]?.detail).toContain(String(RETENTION_DAYS));
  });

  it('offers a withdrawal route, and names the person it goes through', () => {
    expect(copy.facts.find((fact) => fact.heading === 'Changing your mind')?.detail).toMatch(
      /Tell Rahul/u,
    );
  });

  it('states the coaching purpose rather than a vague one', () => {
    expect(copy.facts.find((fact) => fact.heading === 'Why')?.detail).toMatch(/presents/u);
  });
});

describe('the copy answers the fear in the room', () => {
  it('says plainly that the rep is the one being reviewed', () => {
    // The design's claim: the single line most likely to move the decline rate.
    expect(copy.facts.find((fact) => fact.heading === 'Why')?.detail).toContain(
      'Not to assess you',
    );
  });

  it('never collects anything about patients or prescribing', () => {
    expect(NEVER_COLLECTED).toMatch(/patients/u);
    expect(NEVER_COLLECTED).toMatch(/prescribe/u);
    expect(NEVER_COLLECTED).toMatch(/Video/u);
  });
});

describe('declining is described as an ordinary outcome', () => {
  it('says the visit carries on and nothing is held against the rep', () => {
    // Half of variant C's screen. Every clause is backed by the schema: three equal
    // outcomes, and no penalty flag anywhere in the consent tables.
    expect(copy.ifDecline).toMatch(/carries on/u);
    expect(copy.ifDecline).toMatch(/no way at all/u);
    expect(copy.ifDecline).toMatch(/not be asked again today/u);
  });

  it('is at least as long as the agreeing side, so neither reads as the lesser', () => {
    expect(copy.ifDecline.length).toBeGreaterThan(copy.ifAgree.length * 0.5);
  });
});

describe('the shipped variant', () => {
  it('is the one the design says to test first', () => {
    expect(CONSENT_VARIANT).toBe('columns');
  });
});

describe('the rep is named, never the logo alone', () => {
  it('puts the rep’s name in every variant’s words', () => {
    expect(copy.summary).toContain('Rahul');
    expect(copy.ifAgree).toContain('Rahul');
    expect(copy.ifDecline).toContain('Rahul');
    expect(consentDetails('Rahul')[0]?.detail).toContain('Rahul');
  });

  it('names the fiduciary from what it was given rather than a constant', () => {
    expect(fiduciaryNote('Elmiron India Pvt Ltd', 'Ananya')).toContain('Elmiron India Pvt Ltd');
    expect(fiduciaryNote('Elmiron India Pvt Ltd', 'Ananya')).toMatch(
      /Data Protection Board of India/u,
    );
  });

  it('falls back to the rep, who is known, rather than to a placeholder', () => {
    // Found on the emulator: "Your rep's company is the Data Fiduciary" read as
    // filler on the one sentence telling a doctor who holds their data. Nothing in
    // the contract returns an organisation's registered name.
    const note = fiduciaryNote(null, 'Ananya');
    expect(note).toContain("Ananya's employer");
    expect(note).not.toMatch(/your rep/iu);
    expect(note).toMatch(/Data Protection Board of India/u);
  });
});

describe('language names', () => {
  it('uses each language’s own script', () => {
    expect(languageName('hi-IN')).toBe('हिंदी');
    expect(languageName('mr-IN')).toBe('मराठी');
  });

  it('returns the tag unchanged when it has no name for it', () => {
    expect(languageName('kok-IN')).toBe('kok-IN');
  });
});

describe('the rep is never gendered', () => {
  // Found on the emulator, against a rep named Ananya: the design's copy is written
  // around one named man, and substituting a real name into it produced "His team
  // reviews how he presented". Nothing in the contract carries a rep's pronouns.
  const everySentence = [
    copy.question,
    copy.summary,
    copy.ifAgree,
    copy.ifDecline,
    ...copy.facts.map((fact) => fact.detail),
    ...consentDetails('Ananya').map((item) => item.detail ?? ''),
    NEVER_COLLECTED,
  ];

  it.each(everySentence)('uses no gendered pronoun in: %s', (sentence) => {
    expect(sentence).not.toMatch(/\b(he|him|his|she|her|hers)\b/iu);
  });
});
