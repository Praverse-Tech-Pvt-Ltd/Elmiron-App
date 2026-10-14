import { describe, expect, it } from 'vitest';
import { practiceDoctorName, stanceWord } from './labels';

/** `FE-W193` — how the practice screens name a practice doctor. */
describe('practiceDoctorName', () => {
  it('drops the " (practice)" tag every place the name is shown already says', () => {
    expect(practiceDoctorName('Cost-conscious GP (practice)')).toBe('Cost-conscious GP');
    expect(practiceDoctorName('Evidence-first cardiologist (Practice) ')).toBe(
      'Evidence-first cardiologist',
    );
  });

  it('leaves any other name as the company wrote it', () => {
    expect(practiceDoctorName('Dr Sample Rao')).toBe('Dr Sample Rao');
    expect(practiceDoctorName('Dr (practice) Rao')).toBe('Dr (practice) Rao');
  });

  it('a name that is nothing but the tag is not emptied', () => {
    expect(practiceDoctorName('(practice)')).toBe('(practice)');
  });
});

describe('stanceWord', () => {
  it('is the catalogue’s label, with a capital', () => {
    expect(stanceWord('sceptical')).toBe('Sceptical');
    expect(stanceWord('rushed')).toBe('In a hurry');
  });

  it('shows a stance the app does not know as the server sent it', () => {
    expect(stanceWord('curious')).toBe('curious');
  });
});
