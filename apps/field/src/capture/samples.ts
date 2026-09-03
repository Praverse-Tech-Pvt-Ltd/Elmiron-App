import { CreateSampleAndInputRequestSchema } from '@fieldforce/core';
import type { CreateSampleAndInputRequest } from '@fieldforce/core';
import type { SampleLine } from '@fieldforce/ui';

/**
 * C5's arithmetic and validation, away from the renderer.
 *
 * The screen is a presentation of these values; everything that can be got wrong
 * — a value that is not a number, a name that is only spaces, the conversion into
 * a contract request — happens here, where it is tested without a component tree.
 * The same split `today/plan.ts` makes for B1.
 *
 * **Nothing in this module invents a declared value.** `declaredValueInr` is
 * required by the contract and there is no catalogue to resolve it from, so an
 * empty field is a validation failure with a sentence attached rather than a
 * silent zero. A zero posted into an append-only, audit-triggered table is a false
 * declaration that cannot afterwards be edited out.
 */

/** A blank line, ready to be filled in. Quantity starts at 1: nobody leaves zero. */
export const blankLine = (id: string): SampleLine => ({
  id,
  kind: 'sample',
  itemName: '',
  quantity: 1,
  declaredValueInr: '',
});

/**
 * The declared value, as a number, or null when what was typed is not one.
 *
 * Deliberately stricter than `Number()`: that accepts `''` as 0, `'0x10'` as 16
 * and `'1e3'` as 1000, and every one of those is a number the MR did not mean to
 * type into a compliance field. Digits with at most two decimal places is what a
 * rupee amount is.
 */
export const parseDeclaredValue = (typed: string): number | null => {
  const trimmed = typed.trim();
  if (!/^\d+(\.\d{1,2})?$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

/**
 * What is wrong with a line, in the MR's words, or null when nothing is.
 *
 * Each message says what right looks like, not merely that something is wrong —
 * §05's rule for `TextField.error`, applied to the line rather than to one field,
 * because the line is what fails to send.
 */
export const lineError = (line: SampleLine): string | null => {
  if (line.itemName.trim() === '') {
    return 'Name what you left, as it reads on the pack — "Elmiron 100 mg, 30s".';
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    return 'Use the plus key to set how many you left. It cannot be fewer than one.';
  }
  if (parseDeclaredValue(line.declaredValueInr) === null) {
    return 'Put the declared value of one pack in rupees — digits only, like 240 or 240.50.';
  }
  return null;
};

/** Every line's error, keyed by line id. Empty when the whole screen is sendable. */
export const errorsFor = (lines: readonly SampleLine[]): Readonly<Record<string, string>> => {
  const errors: Record<string, string> = {};
  for (const line of lines) {
    const error = lineError(line);
    if (error !== null) errors[line.id] = error;
  }
  return errors;
};

export interface SampleRequestDraft {
  readonly line: SampleLine;
  /** Device-generated so a retry is the same handover rather than a second one. */
  readonly id: string;
  readonly visitId: string;
  readonly doctorId: string;
  /**
   * When it was handed over. The caller passes the device clock here and that is
   * correct: unlike a check-in there is no fix to date this from, and the contract
   * pairs `occurredAt` with a server `receivedAt` precisely so the two can differ.
   */
  readonly occurredAt: string;
}

/**
 * One line as a contract request.
 *
 * Parsed through the contract schema rather than merely shaped like it, so a line
 * that would be refused by the server fails here — on the device, with the MR
 * still standing in front of the doctor — instead of at the far end of a flush
 * hours later.
 */
export const sampleRequest = (draft: SampleRequestDraft): CreateSampleAndInputRequest => {
  const declaredValueInr = parseDeclaredValue(draft.line.declaredValueInr);
  if (declaredValueInr === null) {
    throw new Error('This line has no declared value, so it cannot be sent.');
  }
  return CreateSampleAndInputRequestSchema.parse({
    id: draft.id,
    visitId: draft.visitId,
    doctorId: draft.doctorId,
    kind: draft.line.kind,
    itemName: draft.line.itemName.trim(),
    quantity: draft.line.quantity,
    declaredValueInr,
    occurredAt: draft.occurredAt,
  });
};

/**
 * What the screen says about the UCPMP cap when nothing is counting it.
 *
 * Shown to the MR rather than kept in a comment, for the reason `MileageScreen`'s
 * `rateNote` is: they would otherwise reasonably assume the app is holding a line
 * it is not holding. The wording says who *is* responsible, because "this app does
 * not check" on its own leaves the MR with a warning and no idea what to do with
 * it.
 */
export const CAP_NOTE =
  'This app does not count your samples against the UCPMP cap — nothing in it has been given your limit or your month to date. Keep your own count, and check with your manager before you go near it.';
