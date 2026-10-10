import { describe, expect, it } from 'vitest';
import { failureDetail, refusedDetail } from './plain';

describe('plain-language failures — no SQLSTATE or JS error text as the sentence', () => {
  it('a known remedy is the whole sentence', () => {
    expect(refusedDetail('45001')).toMatch(/consent wording changed/u);
  });

  it('a permission wall names who can help, with the code only as a reference', () => {
    const text = refusedDetail('42501');
    expect(text).toMatch(/^Your account can’t open this/u);
    expect(text.endsWith('Reference: 42501.')).toBe(true);
    expect(text).not.toMatch(/\(42501\)|server refused/u);
  });

  it('an expired session says to sign in again', () => {
    expect(refusedDetail('28000')).toMatch(/sign-in has expired/u);
  });

  it('an unknown code is still a sentence; an absent code adds no empty reference', () => {
    expect(refusedDetail('P0001')).toMatch(/^This was turned down\..*Reference: P0001\.$/u);
    expect(refusedDetail(null)).toBe(
      'This was turned down. If it keeps happening, tell your manager.',
    );
    expect(refusedDetail('  ')).not.toMatch(/Reference/u);
  });

  it('a network failure reads as no signal; anything else never leaks its message', () => {
    expect(failureDetail(new TypeError('Network request failed'))).toMatch(/^No signal/u);
    const odd = failureDetail(new Error('relation "x" does not exist'));
    expect(odd).toMatch(/^Something went wrong/u);
    expect(odd).not.toMatch(/relation/u);
    expect(failureDetail('nope')).toMatch(/^Something went wrong/u);
  });
});
