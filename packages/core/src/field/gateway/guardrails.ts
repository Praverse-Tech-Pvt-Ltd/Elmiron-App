/**
 * Input guardrails that run BEFORE any model call — master prompt §10.
 *
 * "MR chatbot must not become a clinical decision-support system … Implement detection for
 * obvious patient identifiers where practical." And `.ai-collab/constraints.md`: zero patient
 * data in this system. So a question that carries a patient identifier, or asks what a specific
 * patient should take, is refused before it reaches a model and is never stored anywhere — the
 * request log has no column for text (AI-D0).
 *
 * **Deliberately conservative and deliberately crude.** These are patterns, not understanding.
 * A false positive costs an MR a rephrase; a false negative sends a patient's details to a
 * third-party model. The asymmetry decides every borderline pattern below in favour of refusing.
 * They catch the OBVIOUS cases §10 asks for — they are not a guarantee, and nothing here claims
 * to be. A model-based classifier can be added behind them once D2 exists; it would add to these,
 * never replace them, because a model cannot be the only thing standing between patient data and
 * a model.
 */

export type PatientSignal =
  /** An Indian mobile or landline-like run of digits. */
  | 'phone_number'
  /** A 12-digit run shaped like an Aadhaar number. */
  | 'national_id_number'
  | 'email_address'
  /** "patient named …", "my patient Mr …", "patient name is …", and (W1-J) "patient <Name>". */
  | 'patient_named'
  /** A date near "DOB", "born" or "date of birth". */
  | 'date_of_birth'
  /** W1-J: an age or sex marker identifying one person — "aged 62", "58M", "42 year old". */
  | 'patient_demographics'
  /** "what should this patient take", "which dose for my patient" — a request for care advice. */
  | 'patient_specific_advice';

/**
 * W1-J / `BE-W126` — the words that may legitimately follow "patient" in this product.
 *
 * **This stoplist is the whole reason the widened rule below is usable.** `patient portal`,
 * `patient safety` and `Patient Information Leaflet` are things a rep asks about every week, and they
 * all begin with the token the detector keys on. Without this list, widening `patient_named` to catch
 * a bare name would refuse a fifth of ordinary questions — and a guardrail that blocks the app is not
 * a safer guardrail, it is a broken one that gets switched off.
 *
 * Matched case-insensitively, because the same phrase appears as `patient portal` in a question and
 * `Patient Information Leaflet` in a document title.
 */
const PATIENT_COMPOUND_WORDS = new Set([
  // Product and process vocabulary.
  'portal',
  'safety',
  'information',
  'education',
  'educational',
  'support',
  'assistance',
  'adherence',
  'counselling',
  'counseling',
  'leaflet',
  'leaflets',
  'programme',
  'programmes',
  'program',
  'programs',
  'journey',
  'group',
  'groups',
  'population',
  'populations',
  'materials',
  'material',
  'enrolment',
  'enrollment',
  'feedback',
  'satisfaction',
  'experience',
  'outcomes',
  'care',
  'consent',
  'privacy',
  'confidentiality',
  // Words the EXISTING patterns already handle, so the widened rule must not double-fire on them.
  'named',
  'called',
  'name',
  'names',
  'is',
  'was',
  'should',
  'must',
  'may',
  'take',
  'takes',
  'dose',
  'dosage',
  'data',
  'details',
  'records',
  'record',
  'id',
  'ids',
  'number',
  'numbers',
  'list',
  'lists',
  'count',
  'counts',
]);

/** Titles that mark the named person as a CLINICIAN, not a patient. */
const CLINICIAN_TITLES = /^(?:dr|dr\.|doctor|prof|prof\.|professor|surgeon|consultant)$/i;

const PATTERNS: readonly (readonly [PatientSignal, RegExp])[] = [
  // Ten digits starting 6-9 (an Indian mobile) with any spacing — "98765 43210",
  // "987-654-3210" — optionally after +91 or a leading 0.
  ['phone_number', /(?<!\d)(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?!\d)/],
  // Twelve digits, optionally in groups of four.
  ['national_id_number', /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/],
  ['email_address', /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/],
  [
    'patient_named',
    /\bpatient(?:'s)?\s+(?:named|called|name\s+is|is\s+(?:mr|mrs|ms|miss|dr)\b|(?:mr|mrs|ms|miss|shri|smt)\.?\s+[a-z])/i,
  ],
  ['patient_named', /\b(?:my|this|a|the|our)\s+patient\s+(?:mr|mrs|ms|miss|shri|smt)\.?\s+[a-z]/i],
  [
    'date_of_birth',
    /\b(?:dob|d\.o\.b\.?|date\s+of\s+birth|born(?:\s+on)?)\b[^.\n]{0,20}\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/i,
  ],
  [
    'patient_specific_advice',
    /\b(?:my|this|a|the|our|that)\s+patient\b[^.?!\n]{0,60}\b(?:should|take|dose|dosage|prescribe|give|start|stop|switch|increase|reduce)\b/i,
  ],
  [
    'patient_specific_advice',
    /\b(?:should|can|could)\s+(?:i|we)\s+(?:give|prescribe|recommend|start|stop|switch)\b[^.?!\n]{0,60}\b(?:patient|him|her)\b/i,
  ],
];

/**
 * W1-J / `BE-W126` — a bare name after "patient" or "pt", which the PATTERNS above all miss.
 *
 * **Why this is a function and not another entry in `PATTERNS`.** A regex alone cannot do it. The
 * text it must catch — `patient Meena Kumari` — is the same shape as the text it must NOT catch —
 * `Dr Meena Kumari` — and the same shape as `patient portal`. So the decision needs three things a
 * single pattern cannot combine:
 *
 * 1. **the keyed token** — `patient` or `pt`, the latter being how a clinician abbreviates;
 * 2. **a stoplist**, so the product's own vocabulary is not a patient (`PATIENT_COMPOUND_WORDS`);
 * 3. **a capitalisation test on the FOLLOWING word**, which is what distinguishes a name from a
 *    common noun — and which is only safe because (2) removes the title-cased app vocabulary.
 *
 * **`Dr` is not excluded here and does not need to be**, because the trigger is the word `patient`:
 * `Dr Sharma` contains no such token. The clinician exclusion matters for the demographics rule
 * below, where there is no keyed token to rely on.
 */
const namesAPatientDirectly = (text: string): boolean => {
  // `patient` or `pt`, optional possessive/punctuation, then the next word.
  const re = /\b(?:patients?|pt)\b['’]?s?[\s,:;-]+([A-Za-z][\w'’-]*)/giu;
  for (const match of text.matchAll(re)) {
    const next = match[1];
    if (next === undefined) continue;
    if (PATIENT_COMPOUND_WORDS.has(next.toLowerCase())) continue;
    // A capital letter is the signal that this is a name rather than a noun. `patient portal` is
    // lowercase in a question; `Patient Information Leaflet` is title-cased and stoplisted above.
    if (/^[A-Z]/u.test(next)) return true;
  }
  return false;
};

/**
 * W1-J — an age or sex marker that identifies ONE person.
 *
 * This is the half with no `patient` token to key on: `Mrs Sharma aged 62`, `58M with IC`,
 * `a 42 year old female`. **A clinician title suppresses it**, because a rep writing `Dr Sharma` is
 * naming their customer and must not be refused — `CLINICIAN_TITLES` is the whole reason this rule
 * can exist beside a product whose core workflow is doctor names.
 *
 * **The two-digit floor on the shorthand is deliberate.** `\d{2}[MF]` catches `58M` and `42F` but not
 * `3M`, which in this product is a packaging supplier and appears in the corpus for that reason.
 */
const namesPatientDemographics = (text: string): boolean => {
  // "aged 62", "age 62", "62 years old", "62-year-old"
  const agePhrase = /\b(?:aged?\s+\d{1,3}\b|\d{1,3}\s*[-\s]?\s*(?:years?|yrs?)\s*[-\s]?\s*old\b)/iu;
  // "58M", "42 F" — a clinician's shorthand for age and sex.
  //
  // **A CONTEXT WORD IS REQUIRED, and probing is what established that.** The first version was
  // `\b\d{2}\s?[MF]\b` alone, and stress-testing it against realistic rep text outside the corpus
  // found two false positives it would have shipped with:
  //
  //   "the 12F form needs signing"          -> a form number
  //   "I have 25M in my territory target"   -> twenty-five million
  //
  // Neither is a person. What distinguishes `58M with IC` from both is the word after it, so the
  // shorthand now only counts when a clinical context word follows. Both probes are in the corpus as
  // permanent regressions.
  const ageSexShorthand =
    /\b\d{2}\s?[MF]\b[\s,;:-]*(?:with|on|has|had|presents?|presenting|presented|complains?|complaining|diagnosed|reports?|reported|started|taking|c\/o)\b/iu;

  if (ageSexShorthand.test(text)) return true;
  if (!agePhrase.test(text)) return false;

  // An age alone is a weak signal; paired with a named individual it is not. A clinician title on
  // that name suppresses the whole thing.
  // The `i` flag is load-bearing, and its absence was a real bug the corpus caught: without it
  // `Mrs Sharma aged 62` matched nothing, because the alternatives are written lowercase and the
  // text is not. The NAME half stays case-SENSITIVE (`[A-Z][a-z]+`) deliberately — that capital is
  // what distinguishes a name from a common noun.
  const titled =
    /\b(dr|dr\.|doctor|prof|prof\.|professor|mr|mrs|ms|miss|shri|smt)\.?\s+([A-Z][a-z]+)/giu;
  let sawUntitledPerson = false;
  for (const match of text.matchAll(titled)) {
    const title = match[1];
    if (title === undefined) continue;
    if (CLINICIAN_TITLES.test(title)) return false;
    sawUntitledPerson = true;
  }
  if (sawUntitledPerson) return true;

  // No name at all, but an age with a sex word is still one individual: "a 42 year old female".
  return /\b(?:male|female|man|woman|boy|girl|gentleman|lady)\b/iu.test(text);
};

/** Every signal present, de-duplicated, in a stable order. Empty means nothing obvious was found. */
export const detectPatientSignals = (text: string): readonly PatientSignal[] => {
  const found = new Set<PatientSignal>();
  for (const [signal, pattern] of PATTERNS) {
    if (pattern.test(text)) found.add(signal);
  }
  // W1-J / BE-W126. Added after the table because they are decisions, not patterns.
  if (namesAPatientDirectly(text)) found.add('patient_named');
  if (namesPatientDemographics(text)) found.add('patient_demographics');
  return [...found].sort();
};

/**
 * What the MR is told instead of an answer. Educational, and a referral to an approved channel —
 * §10's wording. It does not repeat anything the MR typed.
 */
export const PATIENT_SPECIFIC_REFUSAL_MESSAGE =
  'This assistant cannot give advice about an individual patient, and patient details should not ' +
  'be entered here. For a question about a specific patient, please contact the Medical/Scientific ' +
  'team through the approved channel. If this concerns a possible side effect, report it through ' +
  'the adverse-event process.';
