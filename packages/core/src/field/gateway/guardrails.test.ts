import { describe, expect, it } from 'vitest';
import {
  CLINICAL_MUST_NOT_REFUSE,
  CLINICAL_MUST_REFUSE,
  MUST_NOT_REFUSE,
  MUST_REFUSE,
} from './guardrails.corpus.js';
import { isClinicalQuestion } from './mr-chat.js';
import { detectPatientSignals } from './guardrails.js';

/**
 * W1-J / `BE-W126` — the shared patient guardrail, scored against `guardrails.corpus.ts`.
 *
 * **This file did not exist before W1-J, and that was the real defect behind `BE-W126`.**
 * `detectPatientSignals` is called by `product_qa`, `mr_chat` and `ai_doctor` — three of the four AI
 * features — and had **no test of its own**. It was exercised only incidentally, through two flow
 * suites that each passed it one string. A control shared by three features, tested by nobody, is how
 * a gap of this shape survives: nothing was ever asked to enumerate what it catches.
 *
 * **The corpus is the specification and this file is the score.** Every entry carries its own reason,
 * and the two aggregate tests below fail with the offending phrases named rather than with a count —
 * because "17 of 21 passed" tells you nothing you can act on.
 */

const refuses = (text: string): boolean => detectPatientSignals(text).length > 0;

describe('BE-W126 — the corpus, scored', () => {
  it('refuses every phrase in MUST_REFUSE', () => {
    const missed = MUST_REFUSE.filter((c) => !refuses(c.text));
    // Named, not counted: a failure must say which phrase and why it is in the corpus.
    expect(
      missed.map((c) => `${c.text}   [${c.why}]`),
      `${String(missed.length)} of ${String(MUST_REFUSE.length)} must-refuse phrases were NOT refused`,
    ).toEqual([]);
  });

  it('refuses NOTHING in MUST_NOT_REFUSE', () => {
    const falsePositives = MUST_NOT_REFUSE.filter((c) => refuses(c.text)).map(
      (c) => `${c.text}   -> ${detectPatientSignals(c.text).join(', ')}   [${c.why}]`,
    );
    expect(
      falsePositives,
      `${String(falsePositives.length)} of ${String(MUST_NOT_REFUSE.length)} legitimate phrases were refused`,
    ).toEqual([]);
  });

  it('the corpus is big enough on both sides to mean something', () => {
    // A guard against the corpus being quietly trimmed until the tuning passes.
    expect(MUST_REFUSE.length).toBeGreaterThanOrEqual(15);
    expect(MUST_NOT_REFUSE.length).toBeGreaterThanOrEqual(20);
  });
});

describe('BE-W126 — the specific gap it was filed for', () => {
  it('catches a bare "patient <Firstname Lastname>", which was the whole defect', () => {
    // Before W1-J this returned []. That is what the register entry recorded.
    expect(detectPatientSignals('patient Meena Kumari, 42, has bladder pain')).toContain(
      'patient_named',
    );
  });

  it('catches the "pt" abbreviation', () => {
    expect(detectPatientSignals('pt Ramesh Iyer complains of urgency')).toContain('patient_named');
  });

  it('catches a sentence-initial "Patient <Name>"', () => {
    expect(detectPatientSignals('Patient Anita Desai stopped taking it')).toContain(
      'patient_named',
    );
  });
});

describe('the constraint that shapes the whole tuning: a DOCTOR is not a patient', () => {
  it('does not refuse a doctor by name, even the same name as a patient in the corpus', () => {
    // `patient Meena Kumari` must refuse; `Dr Meena Kumari` must not. Same text shape, opposite
    // answers — which is why "a sequence of capitalised words" can never be the signal.
    expect(detectPatientSignals('met Dr Meena Kumari today, she asked about dosing')).toEqual([]);
    expect(detectPatientSignals('patient Meena Kumari has been on it three months')).not.toEqual(
      [],
    );
  });

  it('a clinician title suppresses the demographics rule', () => {
    expect(detectPatientSignals('Dr Sharma aged 62 runs the clinic')).toEqual([]);
    expect(detectPatientSignals('Mrs Sharma aged 62 is on 400mg twice daily')).toContain(
      'patient_demographics',
    );
  });
});

describe('the stoplist is what makes the widened rule usable', () => {
  it('does not refuse the product’s own vocabulary', () => {
    for (const phrase of [
      'where is the patient portal',
      'how do I report a patient safety issue',
      'where do I find the Patient Information Leaflet',
      'what is the patient support programme',
    ]) {
      expect(detectPatientSignals(phrase), phrase).toEqual([]);
    }
  });

  it('a two-digit floor keeps "3M" from reading as an age', () => {
    expect(detectPatientSignals('the 3M packaging supplier changed')).toEqual([]);
    expect(detectPatientSignals('58M with IC on it for three months, any concerns')).toContain(
      'patient_demographics',
    );
  });
});

describe('everything caught before W1-J is still caught', () => {
  const regressions: readonly [string, string][] = [
    ['my patient Mr Sharma should take what dose', 'patient_named'],
    ['patient named Meena has bladder pain', 'patient_named'],
    ['the patient should take 400mg', 'patient_specific_advice'],
    ['call the family on 98765 43210', 'phone_number'],
    ['her email is meena.kumari@example.com', 'email_address'],
    ['her aadhaar is 1234 5678 9012', 'national_id_number'],
    ['DOB 14/03/1984, started last month', 'date_of_birth'],
  ];

  for (const [text, signal] of regressions) {
    it(`still reports ${signal} for "${text.slice(0, 40)}…"`, () => {
      expect(detectPatientSignals(text)).toContain(signal);
    });
  }
});

// ---------------------------------------------------------------------------
// W1-J Part B — the clinical control, scored the same way.
// ---------------------------------------------------------------------------

describe('Part B — the clinical question, scored', () => {
  it('refuses every phrase in CLINICAL_MUST_REFUSE', () => {
    const missed = CLINICAL_MUST_REFUSE.filter((c) => !isClinicalQuestion(c.text));
    expect(
      missed.map((c) => `${c.text}   [${c.why}]`),
      `${String(missed.length)} of ${String(CLINICAL_MUST_REFUSE.length)} clinical phrases were NOT refused`,
    ).toEqual([]);
  });

  it('refuses NOTHING in CLINICAL_MUST_NOT_REFUSE', () => {
    const falsePositives = CLINICAL_MUST_NOT_REFUSE.filter((c) => isClinicalQuestion(c.text)).map(
      (c) => `${c.text}   [${c.why}]`,
    );
    expect(
      falsePositives,
      `${String(falsePositives.length)} of ${String(CLINICAL_MUST_NOT_REFUSE.length)} process questions were refused`,
    ).toEqual([]);
  });

  it('the residual W1-I recorded is now closed, by name', () => {
    // The exact sentence from the W1-I log: "names no product, carries no patient identifier, and
    // reaches the model. Nothing in this code stops it."
    expect(isClinicalQuestion('is 400mg twice daily normal for interstitial cystitis')).toBe(true);
  });

  it('the procedural frame is load-bearing, and is what makes the control usable', () => {
    // The same clinical word, opposite answers. Without the suppressor the second would be refused,
    // and a rep could not ask how to handle the commonest situation in their job.
    expect(isClinicalQuestion('what is the dosing')).toBe(true);
    expect(isClinicalQuestion('what do I do if a doctor asks about dosing')).toBe(false);
  });

  it('never blocks reporting an adverse event, which is a regulatory obligation', () => {
    expect(isClinicalQuestion('how do I report an adverse event')).toBe(false);
    expect(isClinicalQuestion('how do I log a product query from a doctor')).toBe(false);
  });
});
