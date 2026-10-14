import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { VisitSchema } from '@fieldforce/core';

/**
 * Handover polish, round 2 — Day end, rendered through its route.
 *
 * `FE-W185`: the stop confirmation says what live location is ACTUALLY doing. With sharing on it
 * read "It has not been reading it between visits, it is not reading it now" (QA screenshot 61).
 * `FE-W191`: a visit still checked in is said, not hidden behind the previous visit's check-out.
 */
const mockListMileage = jest.fn<(from: string, to: string) => Promise<unknown>>();
jest.mock('../capture/visits', () => ({
  listMileage: (from: string, to: string) => mockListMileage(from, to),
}));
jest.mock('../api', () => ({
  createClientForScenario: () => {
    throw new Error('day end must not reach the mock server');
  },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockTracker: { current: unknown } = { current: null };
jest.mock('../tracking/tracker', () => ({ useLiveTracker: () => mockTracker.current }));
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

import DayEnd from '../../app/day-end';

const MR = '22222222-2222-4222-8222-2222222222aa';
const visit = (over: Record<string, unknown> = {}) =>
  VisitSchema.parse({
    id: '22222222-2222-4222-8222-222222222201',
    mrId: MR,
    doctorId: '22222222-2222-4222-8222-2222222222bb',
    beatPlanId: null,
    clinicAddressId: null,
    status: 'completed',
    notMetReason: null,
    scheduledFor: null,
    startedAt: '2026-08-13T03:25:00+00:00',
    completedAt: '2026-08-13T12:52:00+00:00',
    receivedAt: '2026-08-13T12:52:01+00:00',
    createdAt: '2026-08-13T02:30:00+00:00',
    updatedAt: '2026-08-13T12:52:01+00:00',
    visitDay: '2026-08-13',
    ...over,
  });

const withVisits = (visits: readonly ReturnType<typeof visit>[]): void => {
  mockStore.mockReturnValue({
    store: { visit: new Map(visits.map((v) => [v.id, v])) },
    status: 'ready',
    today: '2026-08-13',
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    failure: null,
    refresh: jest.fn(),
  });
};

const tracker = (state: string, readingNow: boolean) => ({
  state,
  readingNow,
  closeDay: jest.fn(),
});

beforeEach(() => {
  mockListMileage.mockReset();
  mockListMileage.mockResolvedValue({ kind: 'loaded', days: [] });
  mockStore.mockReset();
  mockTracker.current = null;
  withVisits([visit()]);
});

describe('FE-W185 — the confirmation is true in every live-location state', () => {
  it('no live location in this build: nothing is recorded, a position only on a press', async () => {
    await render(<DayEnd />);
    expect(await screen.findByText('Nothing is being recorded.')).toBeTruthy();
    expect(screen.getByText(/it is not reading it now/u)).toBeTruthy();
  });

  it('sharing: says it is shared and when a position is read — never "not reading it now"', async () => {
    mockTracker.current = tracker('active', true);
    await render(<DayEnd />);
    expect(await screen.findByText('Your live location is being shared.')).toBeTruthy();
    expect(screen.getByText(/every few minutes during your working hours/u)).toBeTruthy();
    expect(screen.queryByText('Nothing is being recorded.')).toBeNull();
    expect(screen.queryByText(/it is not reading it now/u)).toBeNull();
  });

  it('accepted but paused: nothing now, and says when it would read again', async () => {
    mockTracker.current = tracker('paused_day_closed', false);
    await render(<DayEnd />);
    expect(await screen.findByText('Nothing is being recorded.')).toBeTruthy();
    expect(screen.getByText(/Live location is paused/u)).toBeTruthy();
    expect(screen.queryByText(/only ever reads your position/u)).toBeNull();
  });

  it('active without the location permission reads nothing, so it is said as paused', async () => {
    mockTracker.current = tracker('active', false);
    await render(<DayEnd />);
    expect(await screen.findByText('Nothing is being recorded.')).toBeTruthy();
    expect(screen.queryByText('Your live location is being shared.')).toBeNull();
  });
});

describe('FE-W191 — a visit still checked in is said', () => {
  it('in place of the last check-out, which belongs to an earlier visit', async () => {
    withVisits([
      visit(),
      visit({
        id: '22222222-2222-4222-8222-222222222202',
        status: 'in_progress',
        startedAt: '2026-08-13T13:30:00+00:00',
        completedAt: null,
      }),
    ]);
    await render(<DayEnd />);
    expect(await screen.findByText('A visit is still checked in')).toBeTruthy();
    expect(screen.queryByText(/Last check-out/u)).toBeNull();
  });

  it('POSITIVE CONTROL: with every visit checked out, the last check-out is shown', async () => {
    await render(<DayEnd />);
    expect(await screen.findByText('Last check-out 18:22')).toBeTruthy();
  });
});
