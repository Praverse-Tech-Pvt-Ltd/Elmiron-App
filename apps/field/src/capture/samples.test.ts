import { describe, expect, it } from 'vitest';
import { CreateSampleAndInputRequestSchema } from '@fieldforce/core';
import type { SampleLine } from '@fieldforce/ui';
import {
  blankLine,
  CAP_NOTE,
  errorsFor,
  lineError,
  parseDeclaredValue,
  sampleRequest,
} from './samples';

const line = (over: Partial<SampleLine> = {}): SampleLine => ({
  ...blankLine('line-1'),
  itemName: 'Elmiron 100 mg, 30s',
  declaredValueInr: '240',
  ...over,
});

describe('the declared value is parsed strictly, not coerced', () => {
  it.each(['240', '240.5', '240.50', '0'])('accepts the rupee amount "%s"', (typed) => {
    expect(parseDeclaredValue(typed)).toBe(Number(typed));
  });

  it.each([
    // Every one of these is something `Number()` would happily accept, and every
    // one is a figure the MR did not mean to put on a compliance record.
    ['', 'an empty field, which Number() reads as zero'],
    ['0x10', 'hex, which Number() reads as 16'],
    ['1e3', 'exponent notation, which Number() reads as 1000'],
    ['-5', 'a negative amount'],
    ['240.505', 'more precision than a rupee has'],
    ['two forty', 'words'],
  ])('refuses "%s" — %s', (typed) => {
    expect(parseDeclaredValue(typed)).toBeNull();
  });
});

describe('a line says what right looks like, not merely that it is wrong', () => {
  it('passes a complete line', () => {
    expect(lineError(line())).toBeNull();
  });

  it('names the pack when the item has none', () => {
    // Whitespace only. An MR who tabbed through the field has not named anything.
    expect(lineError(line({ itemName: '   ' }))).toMatch(/as it reads on the pack/u);
  });

  it('refuses a handover of nothing', () => {
    expect(lineError(line({ quantity: 0 }))).toMatch(/cannot be fewer than one/u);
  });

  it('asks for the declared value rather than defaulting it to zero', () => {
    // The whole reason the field exists: a zero here is a false declaration in a
    // table that is append-only by grant and audit-logged by trigger.
    expect(lineError(line({ declaredValueInr: '' }))).toMatch(/declared value/u);
  });

  it('keys every failing line and omits the passing ones', () => {
    const errors = errorsFor([line({ id: 'a' }), line({ id: 'b', itemName: '' })]);
    expect(Object.keys(errors)).toEqual(['b']);
  });
});

describe('a line becomes a contract request', () => {
  const draft = {
    id: '15151515-1515-4515-8515-151515151501',
    visitId: '15151515-1515-4515-8515-1515151515aa',
    doctorId: '15151515-1515-4515-8515-1515151515bb',
    occurredAt: '2026-08-14T12:04:00.000Z',
  };

  it('parses through the contract schema rather than merely matching its shape', () => {
    const request = sampleRequest({ ...draft, line: line({ quantity: 2 }) });
    // The proof that it is the contract's own shape and not a look-alike.
    expect(() => CreateSampleAndInputRequestSchema.parse(request)).not.toThrow();
    expect(request.quantity).toBe(2);
    expect(request.declaredValueInr).toBe(240);
  });

  it('trims the item name, so a trailing space is not part of the record', () => {
    expect(sampleRequest({ ...draft, line: line({ itemName: ' Elmiron 100 mg ' }) }).itemName).toBe(
      'Elmiron 100 mg',
    );
  });

  it('refuses to build a request from a line with no declared value', () => {
    expect(() => sampleRequest({ ...draft, line: line({ declaredValueInr: '' }) })).toThrow();
  });
});

describe('the cap note', () => {
  it('says the app is not counting, and who to ask instead', () => {
    // Guarding the file's central claim: this must never quietly become a sentence
    // that implies the app is holding the UCPMP line.
    expect(CAP_NOTE).toMatch(/does not count/u);
    expect(CAP_NOTE).toMatch(/manager/u);
  });
});
