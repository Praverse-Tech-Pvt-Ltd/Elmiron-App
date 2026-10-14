import { describe, expect, it } from 'vitest';
import { durationLabel } from './duration';

/** `FE-W191`. A visit's length as a person says it, never "484 min". */
describe('durationLabel', () => {
  it('keeps a short visit in minutes', () => {
    expect(durationLabel(8)).toBe('8 min');
    expect(durationLabel(1)).toBe('1 min');
    expect(durationLabel(0)).toBe('0 min');
  });

  it('says an hour or more in hours and minutes', () => {
    expect(durationLabel(484)).toBe('8 h 4 min');
    expect(durationLabel(61)).toBe('1 h 1 min');
  });

  it('drops the minutes on the hour', () => {
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(120)).toBe('2 h');
  });
});
