import { describe, expect, it } from 'vitest';
import { CreateAdverseEventFlagRequestSchema } from '@fieldforce/core';
import { adverseEventRequest, identifierNote, identifiersIn } from './adverse-event';

/**
 * W2-C B / `BE-W159` — the flag, and the check that keeps identifiers out of it (`BE-C36`).
 *
 * Two-sided, and the side a careless test skips is the ORDINARY report: a side effect is described
 * with numbers in it — doses, days, counts — and none of that may be mistaken for a phone number.
 */
describe('identifiersIn — what has a shape, and what does not', () => {
  it('ORDINARY clinical text with numbers in it is not an identifier', () => {
    for (const text of [
      'Rash after 500 mg twice a day for 10 days.',
      'Dizziness 2 hours after the 3rd dose; BP 140/90.',
      'Patient in Pune 411001 reported nausea.', // a PIN code is six digits
      'Started 06/10/2026, stopped 08/10/2026.',
    ]) {
      expect(identifiersIn(text), text).toEqual([]);
    }
  });

  it('a phone number is found, however it is typed', () => {
    for (const text of [
      'Call 9876543210 for details',
      'phone +91 98765 43210',
      'reach her on 98765-43210',
    ]) {
      expect(identifiersIn(text), text).toEqual(['phone']);
    }
  });

  it('an email address and a twelve-digit ID number are found', () => {
    expect(identifiersIn('write to ravi.k@example.com')).toEqual(['email']);
    expect(identifiersIn('Aadhaar 1234 5678 9012')).toEqual(['id_number']);
  });

  it('says what it found, in words, and nothing when it found nothing', () => {
    expect(identifierNote([])).toBeNull();
    expect(identifierNote(['phone'])).toBe(
      'This looks like it contains a phone number. Take it out before sending — the safety team does not need it.',
    );
    expect(identifierNote(['email', 'phone'])).toMatch(/an email address and a phone number/u);
  });
});

describe('the request — four fields, and the absences are the design', () => {
  const request = adverseEventRequest({
    id: '88888888-8888-4888-8888-888888888801',
    visitId: '88888888-8888-4888-8888-888888888802',
    text: '  Rash after the second dose.  ',
    at: '2026-10-06T10:00:00.000Z',
  });

  it('is who/when/what only, the words trimmed, and passes the contract', () => {
    expect(request).toEqual({
      id: '88888888-8888-4888-8888-888888888801',
      visitId: '88888888-8888-4888-8888-888888888802',
      reportedText: 'Rash after the second dose.',
      clientReportedAt: '2026-10-06T10:00:00.000Z',
    });
    expect(CreateAdverseEventFlagRequestSchema.safeParse(request).success).toBe(true);
  });

  it('the contract refuses an EMPTY flag and carries no severity or patient field', () => {
    expect(
      CreateAdverseEventFlagRequestSchema.safeParse({ ...request, reportedText: '  ' }).success,
    ).toBe(false);
    // Unknown fields are stripped, not carried: a severity cannot ride along.
    const parsed = CreateAdverseEventFlagRequestSchema.parse({
      ...request,
      severity: 'serious',
      patientName: 'X',
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'clientReportedAt',
      'id',
      'reportedText',
      'visitId',
    ]);
  });
});
