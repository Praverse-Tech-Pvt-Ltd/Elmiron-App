import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('FE-W166 — plural', () => {
  it('agrees the noun with the count', () => {
    expect(plural(1, 'visit', 'visits')).toBe('1 visit');
    expect(plural(0, 'visit', 'visits')).toBe('0 visits');
    expect(plural(3, 'visit', 'visits')).toBe('3 visits');
  });

  it('takes an irregular plural from the caller rather than guessing it', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(56, 'entry', 'entries')).toBe('56 entries');
  });
});
