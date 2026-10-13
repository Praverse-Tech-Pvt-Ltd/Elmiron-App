import { describe, expect, it } from 'vitest';
import { googleMapsUrl } from '@fieldforce/core';
import { accuracyLabel, ageLabel, clockIn, trackingRefusal } from './tracking-text';

describe('FE-W72 — live tracking text', () => {
  it('shows the time on the REP’s clock, not this machine’s', () => {
    // 05:38 UTC is 11:08 in India.
    expect(clockIn('2026-10-13T05:38:23.085541+00:00', 'Asia/Kolkata')).toBe('11:08');
    expect(clockIn('2026-10-13T05:38:23Z', 'UTC')).toBe('05:38');
  });

  it.each([
    { seconds: 0, label: 'under a minute ago' },
    { seconds: 59, label: 'under a minute ago' },
    { seconds: 60, label: '1 min ago' },
    { seconds: 3_660, label: '1 h 1 min ago' },
    { seconds: 2 * 86_400, label: '2 day(s) ago' },
  ])('an age of $seconds s reads "$label"', ({ seconds, label }) => {
    expect(ageLabel(seconds)).toBe(label);
  });

  it('says when accuracy was not reported rather than inventing one', () => {
    expect(accuracyLabel(null)).toBe('accuracy not reported');
    expect(accuracyLabel(12.4)).toBe('within about 12 m');
  });

  it('names each refusal the database makes, and passes anything else through as the server’s', () => {
    expect(trackingRefusal({ message: "only a manager or an admin sees reps' locations" })).toMatch(
      /field manager or an admin/,
    );
    expect(
      trackingRefusal({ code: '22023', message: 'live_tracking_switch_needs_reason' }),
    ).toMatch(/Say why/);
    expect(trackingRefusal({ message: 'something new' })).toBe(
      'The server refused this: something new',
    );
  });

  it('links a position to Google Maps with no key', () => {
    expect(googleMapsUrl(18.5204, 73.8567)).toBe('https://www.google.com/maps?q=18.5204,73.8567');
  });
});
