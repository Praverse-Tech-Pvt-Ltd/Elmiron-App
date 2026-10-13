import { describe, expect, it } from 'vitest';
import type { TeamWorkDay } from '@fieldforce/core';
import {
  attendance,
  distanceLabel,
  reopenRefusal,
  teamDaysRefusal,
  timeIn,
} from './team-days-text';

/**
 * `BE-W191`. Each message below is the database's own text from `20261013000310_work_days`, so a
 * reworded refusal there fails here instead of reaching a manager as a raw SQL sentence.
 */
describe('reopenRefusal', () => {
  it('names each refusal a manager can act on', () => {
    expect(
      reopenRefusal({
        code: '22023',
        message: 'reopen_needs_reason: say why the day is being reopened (3 to 500 characters)',
      }),
    ).toMatch(/Say why/u);
    expect(
      reopenRefusal({
        code: '22023',
        message:
          'work_day_not_closed: the working day 2026-10-13 is open, so there is nothing to reopen',
      }),
    ).toMatch(/already open/u);
    expect(
      reopenRefusal({ code: '42501', message: 'only a manager or an admin reopens a working day' }),
    ).toMatch(/field manager or an admin/u);
    expect(
      reopenRefusal({
        code: '42501',
        message: 'work day 7b0c… is not one you may reopen',
      }),
    ).toMatch(/not in your team/u);
  });

  it('says plainly when it does not recognise the refusal, rather than guessing', () => {
    expect(reopenRefusal({ code: 'XX000', message: 'something else' })).toBe(
      'The server refused this: something else',
    );
    expect(teamDaysRefusal({ message: 'something else' })).toBe(
      'The server refused this: something else',
    );
  });

  it('names the team-days refusal for a rep who opens the page', () => {
    expect(
      teamDaysRefusal({ message: "only a manager or an admin sees the team's working days" }),
    ).toMatch(/Only a field manager or an admin/u);
  });
});

const day = (over: Partial<TeamWorkDay> = {}): TeamWorkDay => ({
  mr_id: '33333333-3333-4333-8333-333333333301',
  full_name: 'Asha Rep',
  territory_name: 'Pune',
  work_day_id: '33333333-3333-4333-8333-333333333302',
  status: 'closed',
  time_zone: 'Asia/Kolkata',
  opened_at: '2026-10-13T03:25:00+00:00',
  opened_via: 'check_in',
  closed_at: '2026-10-13T12:52:00+00:00',
  closing_note: null,
  visits_total: 5,
  visits_completed: 3,
  visits_not_met: 1,
  visits_missed: 1,
  distance_metres: 48_200,
  samples_quantity: 4,
  reopen_count: 0,
  ...over,
});

describe('the figures', () => {
  it('shows a stamp in the zone the DAY was reckoned in, not the browser’s', () => {
    // 03:25 UTC is 08:55 in India; a browser in UTC would print 03:25.
    expect(timeIn('2026-10-13T03:25:00+00:00', 'Asia/Kolkata')).toBe('08:55');
    expect(timeIn('2026-10-13T03:25:00+00:00', 'UTC')).toBe('03:25');
    expect(timeIn(null, 'Asia/Kolkata')).toBeNull();
    expect(timeIn('2026-10-13T03:25:00+00:00', null)).toBeNull();
  });

  it('counts attendance, not achievement: a doctor not met was still attended', () => {
    expect(attendance(day())).toBe('4 of 5 attended, 1 not started');
    expect(attendance(day({ visits_missed: 0, visits_not_met: 2, visits_completed: 3 }))).toBe(
      '5 of 5 attended',
    );
  });

  it('has no attendance for an OPEN day: it has no snapshot yet', () => {
    expect(
      attendance(
        day({
          status: 'open',
          closed_at: null,
          visits_total: null,
          visits_completed: null,
          visits_not_met: null,
          visits_missed: null,
        }),
      ),
    ).toBeNull();
  });

  it('a real zero distance is a figure; an unknown one is not', () => {
    expect(distanceLabel(0)).toBe('0.0 km');
    expect(distanceLabel(48_200)).toBe('48.2 km');
    expect(distanceLabel(null)).toBeNull();
  });
});
