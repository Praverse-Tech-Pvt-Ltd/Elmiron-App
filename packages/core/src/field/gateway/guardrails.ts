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
  /** "patient named …", "my patient Mr …", "patient name is …". */
  | 'patient_named'
  /** A date near "DOB", "born" or "date of birth". */
  | 'date_of_birth'
  /** "what should this patient take", "which dose for my patient" — a request for care advice. */
  | 'patient_specific_advice';

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

/** Every signal present, de-duplicated, in a stable order. Empty means nothing obvious was found. */
export const detectPatientSignals = (text: string): readonly PatientSignal[] => {
  const found = new Set<PatientSignal>();
  for (const [signal, pattern] of PATTERNS) {
    if (pattern.test(text)) found.add(signal);
  }
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
