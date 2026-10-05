/**
 * W1-J A1 — the corpus `BE-W126` is tuned against, written BEFORE the patterns were touched.
 *
 * **Why this is a file and not a list inside a test.** The guardrail's own header states the
 * asymmetry that decides every borderline case — *"a false positive costs an MR a rephrase; a false
 * negative sends a patient's details to a third-party model"* — and a tuning judged against examples
 * invented to fit the pattern is not a tuning. These phrases are the specification; `guardrails.ts`
 * is an attempt at it, and `guardrails.test.ts` reports the score including what it still gets wrong.
 *
 * **The hard half is `MUST_NOT_REFUSE`, and the hardest thing in it is a DOCTOR'S NAME.** A rep
 * types doctor names constantly — it is the core of their job — and `AI-SPEC` §2 A3 says so
 * explicitly: *"A doctor's name: possible — it is free text."* A patient's name and a doctor's name
 * are the same shape of text. **So "a sequence of capitalised words" can never be the signal**, and
 * any tuning that refuses `add Dr Sharma to my beat plan` has broken the product to protect it.
 *
 * The other half of `MUST_NOT_REFUSE` is the app's own vocabulary. `patient portal`, `patient safety`
 * and `Patient Information Leaflet` are things a rep legitimately asks about, and they all begin with
 * the word the detector keys on.
 */

/** A phrase, and why it is in the corpus. The reason is part of the data, not a comment. */
export interface CorpusEntry {
  readonly text: string;
  readonly why: string;
}

/**
 * Phrases that MUST be refused. Every one either identifies an individual or asks for care advice
 * about one.
 */
export const MUST_REFUSE: readonly CorpusEntry[] = [
  // --- the gap BE-W126 names: a bare name after "patient", no title, no "named" ---
  {
    text: 'patient Meena Kumari, 42, has bladder pain',
    why: 'BE-W126: the commonest way a person actually writes it. Caught nothing before.',
  },
  {
    text: 'patient Meena Kumari has been on it three months',
    why: 'BE-W126: a bare name with no age either.',
  },
  {
    text: 'pt Ramesh Iyer complains of urgency',
    why: 'BE-W126: "pt" is how a clinician abbreviates.',
  },
  {
    text: 'Patient Anita Desai stopped taking it',
    why: 'BE-W126: sentence-initial capital, so a case-sensitive rule alone would miss it.',
  },

  // --- demographics beside a name, with no "patient" word at all ---
  {
    text: 'Mrs Sharma aged 62 is on 400mg twice daily',
    why: 'A named individual with an age. No "patient" token to key on.',
  },
  {
    text: '58M with IC on it for three months, any concerns',
    why: 'The shorthand a clinician writes. No name, still one person.',
  },
  {
    text: 'a 42 year old female with interstitial cystitis, what dose',
    why: 'Age and sex identify an individual even with no name.',
  },

  // --- already caught before this session; they must STAY caught ---
  {
    text: 'my patient Mr Sharma should take what dose',
    why: 'Regression: patient_named + advice.',
  },
  { text: 'patient named Meena has bladder pain', why: 'Regression: the explicit "named" form.' },
  { text: 'the patient should take 400mg', why: 'Regression: patient_specific_advice.' },
  { text: 'should I give her the higher dose', why: 'Regression: advice about a person.' },
  { text: 'call the family on 98765 43210', why: 'Regression: phone_number.' },
  { text: 'her email is meena.kumari@example.com', why: 'Regression: email_address.' },
  { text: 'her aadhaar is 1234 5678 9012', why: 'Regression: national_id_number.' },
  { text: 'DOB 14/03/1984, started last month', why: 'Regression: date_of_birth.' },
];

/**
 * Phrases that MUST NOT be refused. A refusal here is a rep blocked from using their own app.
 */
export const MUST_NOT_REFUSE: readonly CorpusEntry[] = [
  // --- DOCTOR names. The hardest constraint, and explicitly permitted by the spec. ---
  { text: 'add Dr Sharma to my beat plan', why: 'A doctor by name. The core of the job.' },
  {
    text: 'met Dr Meena Kumari today, she asked about dosing',
    why: 'A doctor with the SAME name shape as a patient in MUST_REFUSE.',
  },
  {
    text: 'Dr Ramesh Iyer wants the leaflet',
    why: 'Same first and last name as a MUST_REFUSE entry, only the title differs.',
  },
  { text: 'is Prof Anita Desai in my territory', why: 'Another doctor title.' },
  { text: 'how do I record a visit to Dr Sharma', why: 'A process question that names a doctor.' },

  // --- the app's own vocabulary, all beginning with the keyed word ---
  { text: 'where is the patient portal', why: 'App vocabulary.' },
  { text: 'how do I report a patient safety issue', why: 'App vocabulary, and a real obligation.' },
  {
    text: 'where do I find the Patient Information Leaflet',
    why: 'Title case, so a capital follows "Patient".',
  },
  { text: 'what is the patient support programme', why: 'App vocabulary.' },
  { text: 'how does patient assistance enrolment work', why: 'App vocabulary.' },
  { text: 'explain the patient adherence programme', why: 'App vocabulary.' },
  { text: 'where are the patient education materials', why: 'App vocabulary.' },
  { text: 'what goes in the patient counselling section of the label', why: 'Label section name.' },

  // --- ordinary process questions, the bulk of what mr_chat exists for ---
  { text: 'how do I file a call report', why: 'The example the spec itself uses.' },
  { text: 'where is the beat plan', why: 'Process.' },
  { text: 'what should I do first thing in the morning', why: 'Process, and contains "should".' },
  { text: 'how do I check out of a visit', why: 'Process.' },
  { text: 'what is the sample cap for this month', why: 'Process, contains a quantity.' },
  { text: 'I have 30 day supply left to record', why: 'A quantity with a time unit near it.' },
  { text: 'the 3M packaging supplier changed', why: 'A digit-letter token that is not an age.' },

  // --- W1-J: found by PROBING outside the corpus, after the first tuning passed it cleanly. ---
  // A clean sweep meant the corpus was too kind, so twenty more realistic phrases were tried and
  // these two fired. They are here so they can never regress.
  {
    text: 'the 12F form needs signing',
    why: 'PROBE: a form number read as age+sex by the first shorthand rule.',
  },
  {
    text: 'I have 25M in my territory target',
    why: 'PROBE: twenty-five million read as a 25-year-old male.',
  },
  {
    text: 'the study had 400 patients aged 18 to 65',
    why: 'PROBE: an aggregate with an age phrase and no individual.',
  },
  {
    text: 'how many patients are on the programme in my territory',
    why: 'PROBE: plural, aggregate.',
  },
  { text: 'Mrs Iyer from the pharmacy called', why: 'PROBE: a titled non-patient with no age.' },
  { text: 'aged care facility visit tomorrow', why: 'PROBE: "aged" with no number.' },
];

// ---------------------------------------------------------------------------
// W1-J Part B — the CLINICAL corpus, scored the same way as the patient one.
// ---------------------------------------------------------------------------

/**
 * Clinical questions `mr_chat` must refuse. **None of these names a product**, so the catalogue check
 * cannot see them — which is exactly what W1-I recorded as the residual.
 */
export const CLINICAL_MUST_REFUSE: readonly CorpusEntry[] = [
  {
    text: 'is 400mg twice daily normal for interstitial cystitis',
    why: 'THE residual W1-I recorded verbatim. Also the phrase that exposed a word-boundary bug in the unit pattern.',
  },
  { text: 'what is the usual dose for IC', why: 'A dose question with no product named.' },
  { text: 'what are the contraindications', why: 'Prescribing information.' },
  { text: 'is it safe in pregnancy', why: 'A safety question about a population.' },
  { text: 'what is the half life', why: 'Pharmacokinetics.' },
  { text: 'any interactions with warfarin', why: 'An interaction question.' },
  { text: 'what is the paediatric dosage', why: 'A population dose.' },
  { text: 'can the dose be titrated up', why: 'Titration is a clinical decision.' },
  { text: 'is it hepatic or renal clearance', why: 'Pharmacokinetics.' },
  { text: 'what is the efficacy versus placebo', why: 'An efficacy claim.' },
  {
    text: '400 mg BD ok for an elderly person',
    why: 'A dosage amount with a space before the unit.',
  },
];

/**
 * Process questions that MUST NOT be refused even though they contain clinical words.
 *
 * **This half decides whether the control is usable.** A rep who cannot ask *"what do I do if a
 * doctor asks about dosing"* has lost the assistant's main purpose, and a guardrail that blocks the
 * product gets switched off rather than respected.
 */
export const CLINICAL_MUST_NOT_REFUSE: readonly CorpusEntry[] = [
  { text: 'how do I file a call report', why: 'The spec’s own example.' },
  { text: 'where is the beat plan', why: 'Process.' },
  { text: 'how do I record a sample drop', why: 'Process.' },
  { text: 'what is the sample cap for this month', why: 'Process with a quantity.' },
  { text: 'how do I add a doctor to my territory', why: 'Process.' },
  {
    text: 'where do I find the Patient Information Leaflet',
    why: 'Process; also in the patient corpus.',
  },
  {
    text: 'how do I report an adverse event',
    why: 'A REGULATORY OBLIGATION. Blocking this would be the worst false positive available.',
  },
  { text: 'what is the process for a quality complaint', why: 'Another obligation.' },
  {
    text: 'how do I log a product query from a doctor',
    why: 'The correct route for a clinical question.',
  },
  {
    text: 'what do I do if a doctor asks about dosing',
    why: 'Contains "dosing" and is purely procedural.',
  },
  {
    text: 'the doctor asked about contraindications, what is the process',
    why: 'Contains a clinical term and asks for the process.',
  },
  { text: 'how do I escalate a medical question', why: 'The escalation path itself.' },
  {
    text: 'where do I find the dosing leaflet to hand over',
    why: 'Contains "dosing", asks where a document is.',
  },
  { text: 'how do I check out of a visit', why: 'Process.' },
  { text: 'I have 5 samples left', why: 'A bare quantity a naive dosage pattern would catch.' },
  { text: 'the 30 day supply arrived', why: 'A quantity with a unit-like word.' },
  { text: 'how do I file an expense of 500', why: 'A number with no unit.' },
];
