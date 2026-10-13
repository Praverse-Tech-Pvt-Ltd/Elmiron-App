import { describe, expect, it } from 'vitest';
import {
  LiveTrackingStatusSchema,
  PingVerdictSchema,
  TrackingOverviewSchema,
  googleMapsUrl,
} from './live-tracking.js';

/**
 * `BE-W180` — the live-tracking shapes, against bodies copied from the functions' real output
 * (`20261013000100_live_tracking`, run against the local stack in a rolled-back transaction).
 */
const NOTICE = '4e86b49c-05fc-4bd8-9f75-16e22a64309a';

describe('live tracking contract', () => {
  it('parses what my_live_tracking answers, including Postgres offsets and no window', () => {
    const status = LiveTrackingStatusSchema.parse({
      today: '2026-10-13',
      accepted: false,
      shiftEnd: null,
      timeZone: null,
      serverTime: '2026-10-13T05:38:23.085541+00:00',
      companyEnabled: false,
      intervalSeconds: 300,
      withinWorkingHours: false,
      acceptedNoticeVersionId: null,
      notice: { id: NOTICE, versionLabel: 'DRAFT', body: 'text', isDraft: true },
    });
    expect(status.notice?.isDraft).toBe(true);
  });

  it('refuses an interval outside the bounds the server holds', () => {
    // The server clamps to [60, 3600]; a body outside it is not from this server.
    const body = {
      today: '2026-10-13',
      accepted: true,
      shiftEnd: '19:00:00',
      timeZone: 'Asia/Kolkata',
      serverTime: '2026-10-13T05:38:23+00:00',
      companyEnabled: true,
      withinWorkingHours: true,
      acceptedNoticeVersionId: NOTICE,
      notice: null,
    };
    expect(LiveTrackingStatusSchema.safeParse({ ...body, intervalSeconds: 5 }).success).toBe(false);
    expect(LiveTrackingStatusSchema.safeParse({ ...body, intervalSeconds: 60 }).success).toBe(true);
  });

  it('parses a refusal verdict and refuses an unknown reason', () => {
    const verdict = { stored: false, replayed: false, reason: 'too_frequent', receivedAt: null };
    expect(PingVerdictSchema.parse(verdict).reason).toBe('too_frequent');
    expect(PingVerdictSchema.safeParse({ ...verdict, reason: 'made_up' }).success).toBe(false);
  });

  it('parses the overview with and without a latest position', () => {
    const overview = TrackingOverviewSchema.parse({
      reps: [
        {
          mrId: '00000000-0000-4000-8000-0000000000c1',
          today: '2026-10-13',
          latest: {
            latitude: 18.5,
            accuracyM: 12,
            longitude: 73.8,
            ageSeconds: 0,
            receivedAt: '2026-10-13T05:38:23.128902+00:00',
            recordedAt: '2026-10-13T05:38:23.085541+00:00',
          },
          accepted: true,
          timeZone: 'Asia/Kolkata',
          fullName: 'LT Rep',
          pingsToday: 1,
          territoryName: 'LT child',
        },
        {
          mrId: '00000000-0000-4000-8000-0000000000c5',
          today: '2026-10-13',
          latest: null,
          accepted: false,
          timeZone: 'UTC',
          fullName: 'Second',
          pingsToday: 0,
          territoryName: null,
        },
      ],
      notice: { id: NOTICE, isDraft: true, versionLabel: 'DRAFT 2026-10-13 (not approved)' },
      serverTime: '2026-10-13T05:38:23.085541+00:00',
      companyEnabled: true,
      canChangeSwitch: false,
      intervalSeconds: 300,
    });
    expect(overview.reps.map((r) => r.latest === null)).toEqual([false, true]);
  });

  it('builds a Google Maps link from the coordinates alone', () => {
    expect(googleMapsUrl(18.5204, 73.8567)).toBe('https://www.google.com/maps?q=18.5204,73.8567');
    expect(googleMapsUrl(-33.9, 151.2)).toBe('https://www.google.com/maps?q=-33.9,151.2');
  });
});
