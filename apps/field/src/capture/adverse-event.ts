import type { CreateAdverseEventFlagRequest } from '@fieldforce/core';

/**
 * W2-C B / `BE-W159` — the rep's flag, and the check that keeps identifiers out of it (`BE-C36`).
 *
 * **What this detects, and what it cannot.** Things with a SHAPE: a phone number (ten or more digits
 * once spaces, dashes and a leading +91 are set aside), an email address, and a twelve-digit number
 * of the kind an Aadhaar number is. A patient's NAME has no shape a phone can recognise without
 * flagging every drug and doctor named in the same sentence, so it is not attempted; the screen asks
 * for none, in words. This narrows the easy mistakes. It is not a guarantee, and nothing here claims
 * it is.
 */
export type IdentifierKind = 'phone' | 'email' | 'id_number';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

/** Runs of digits once the separators people type inside numbers are removed. */
const digitRuns = (text: string): string[] =>
  text
    // The +91 country code goes first: without it "+91 98765 43210" joins into twelve digits
    // and reads as an ID number (caught by this module's own test).
    .replace(/\+91[\s-]?/gu, '')
    .replace(/(?<=\d)[\s-](?=\d)/gu, '')
    .match(/\d+/gu) ?? [];

export const identifiersIn = (text: string): readonly IdentifierKind[] => {
  const found = new Set<IdentifierKind>();
  if (EMAIL.test(text)) found.add('email');
  for (const run of digitRuns(text)) {
    if (run.length === 12) found.add('id_number');
    else if (run.length >= 10) found.add('phone');
  }
  return [...found];
};

const NAMES: Record<IdentifierKind, string> = {
  phone: 'a phone number',
  email: 'an email address',
  id_number: 'an ID number',
};

/** The sentence under a withheld Send button, or null when nothing was found. */
export const identifierNote = (kinds: readonly IdentifierKind[]): string | null => {
  if (kinds.length === 0) return null;
  const listed = kinds.map((kind) => NAMES[kind]);
  const what =
    listed.length === 1
      ? listed[0]
      : `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1] ?? ''}`;
  return `This looks like it contains ${what ?? ''}. Take it out before sending — the safety team does not need it.`;
};

export interface AdverseEventDraft {
  readonly id: string;
  readonly visitId: string;
  readonly text: string;
  /** The device's instant — beside the server's receipt, which is the one the deadline runs from. */
  readonly at: string;
}

export const adverseEventRequest = (draft: AdverseEventDraft): CreateAdverseEventFlagRequest => ({
  id: draft.id,
  visitId: draft.visitId,
  reportedText: draft.text.trim(),
  clientReportedAt: draft.at,
});
