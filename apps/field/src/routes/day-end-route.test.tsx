import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { VisitSchema } from '@fieldforce/core';

/**
 * B7 — Day end.
 *
 * FE-D14. The screen reads the REAL server now:
 *
 * - the day's visits come from the pulled store (`sync_pull`), chosen by the same `onDay` rule
 *   Today uses, so the two screens cannot disagree about which visits were today's;
 * - the distance comes from `daily_mileage` (`listMileage`), which CR-3 proved an MR may call.
 *
 * The mock client is mocked to THROW, so any path back to `127.0.0.1:4010` fails these cases.
 * Supabase renders timestamps in UTC (`+00:00`), so the check-in/out times are asserted through
 * the territory zone: a character slice would read 03:25 where the rep checked in at 08:55.
 */

const mockListMileage = jest.fn<(from: string, to: string) => Promise<unknown>>();
jest.mock('../capture/visits', () => ({
  listMileage: (from: string, to: string) => mockListMileage(from, to),
}));
const mockMockClient = jest.fn(() => {
  throw new Error('FE-D14: day end must not reach the mock server');
});
jest.mock('../api', () => ({ createClientForScenario: () => mockMockClient() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

import DayEnd from '../../app/day-end';

const IST = { timeZone: 'Asia/Kolkata', source: 'territory' } as const;
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
    // 08:55 and 18:22 IST, as Supabase sends them: in UTC.
    startedAt: '2026-08-13T03:25:00+00:00',
    completedAt: '2026-08-13T12:52:00+00:00',
    receivedAt: '2026-08-13T12:52:01+00:00',
    createdAt: '2026-08-13T02:30:00+00:00',
    updatedAt: '2026-08-13T12:52:01+00:00',
    visitDay: '2026-08-13',
    ...over,
  });

const mileage = (distanceMetres: number | null) =>
  distanceMetres === null
    ? { kind: 'loaded', days: [] }
    : {
        kind: 'loaded',
        days: [{ mrId: MR, travelDate: '2026-08-13', distanceMetres, checkInCount: 2 }],
      };

/** A pulled store holding `visits`, with the given status and territory day. */
const withStore = ({
  visits = [visit()],
  status = 'ready',
  today = '2026-08-13',
  failure = null,
}: {
  visits?: readonly ReturnType<typeof visit>[];
  status?: 'loading' | 'ready' | 'failed';
  today?: string | null;
  failure?: unknown;
} = {}) => {
  mockStore.mockReturnValue({
    store: { visit: new Map(visits.map((v) => [v.id, v])) },
    status,
    today,
    zone: IST,
    failure,
  });
};

beforeEach(() => {
  mockListMileage.mockReset();
  mockMockClient.mockClear();
  mockStore.mockReset();
});

describe('app/day-end.tsx — B7', () => {
  it("carries the stop confirmation and the day's real figures", async () => {
    withStore();
    mockListMileage.mockResolvedValue(mileage(48_200));

    await render(<DayEnd />);

    expect(await screen.findByText('48.2 km')).toBeTruthy();
    expect(screen.getByText('Nothing is being recorded.')).toBeTruthy();
    expect(screen.getByText('First check-in 08:55')).toBeTruthy();
    expect(screen.getByText('Last check-out 18:22')).toBeTruthy();
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });

  it('keeps the confirmation standing when the pull has failed, with the counts not available', async () => {
    withStore({ status: 'failed', failure: { kind: 'unreachable' } });
    mockListMileage.mockResolvedValue(mileage(null));

    await render(<DayEnd />);

    expect(await screen.findByText('Nothing is being recorded.')).toBeTruthy();
    expect(await screen.findByText(/Not available/u)).toBeTruthy();
    expect(screen.queryByText('0 of 0')).toBeNull();
    expect(screen.queryByText('you went to all of them')).toBeNull();
  });

  it('keeps the visit counts when only the mileage is refused', async () => {
    withStore();
    mockListMileage.mockResolvedValue({
      kind: 'refused',
      refusal: { code: 'unknown', sqlState: 'XX000', actionable: false },
    });

    await render(<DayEnd />);

    expect(await screen.findByText(/Distance not available/u)).toBeTruthy();
    expect(screen.getByText('1 of 1')).toBeTruthy();
    expect(screen.queryByText(/No distance yet/u)).toBeNull();
  });

  it('keeps the visit counts when the mileage request fails outright', async () => {
    withStore();
    mockListMileage.mockRejectedValue(new Error('Network request failed'));

    await render(<DayEnd />);

    expect(await screen.findByText(/Distance not available/u)).toBeTruthy();
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });
});

describe('FE-D14 — day end reads the real server', () => {
  it('asks daily_mileage for the territory day only, and never the mock', async () => {
    withStore({ today: '2026-10-01', visits: [] });
    mockListMileage.mockResolvedValue(mileage(null));

    await render(<DayEnd />);
    await screen.findByText('nothing was planned');

    expect(mockListMileage).toHaveBeenCalledWith('2026-10-01', '2026-10-01');
    expect(mockMockClient).not.toHaveBeenCalled();
  });

  it("counts only today's visits, by the server's visit_day", async () => {
    withStore({
      visits: [
        visit(),
        visit({ id: '22222222-2222-4222-8222-222222222202', visitDay: '2026-08-12' }),
      ],
    });
    mockListMileage.mockResolvedValue(mileage(null));

    await render(<DayEnd />);

    expect(await screen.findByText('1 of 1')).toBeTruthy();
  });

  it('a pull refused as not permitted is the denial state', async () => {
    withStore({
      status: 'failed',
      failure: {
        kind: 'refused',
        refusal: { code: 'not_permitted', sqlState: '42501', actionable: false },
      },
    });
    mockListMileage.mockResolvedValue(mileage(null));

    await render(<DayEnd />);

    expect(await screen.findByText('You do not have access to this day')).toBeTruthy();
  });

  it('with NO server day, asks for nothing and names the missing thing', async () => {
    withStore({ today: null });

    await render(<DayEnd />);

    expect(await screen.findByText('Could not confirm which day this is')).toBeTruthy();
    expect(mockListMileage).not.toHaveBeenCalled();
  });
});

/**
 * FE-D2 7 — an unknown count is not a zero, and a zero is not a congratulation.
 */
describe('FE-D2 7 — day-end: unknown vs zero', () => {
  it('while the first pull is still loading, shows no count and no verdict', async () => {
    withStore({ status: 'loading', visits: [] });
    mockListMileage.mockReturnValue(new Promise(() => undefined));
    await render(<DayEnd />);
    await screen.findByText('Nothing is being recorded.');

    expect(screen.queryByText('0 of 0')).toBeNull();
    expect(screen.queryByText('you went to all of them')).toBeNull();
  });

  it('a day with nothing planned says so, and does not congratulate', async () => {
    withStore({ visits: [] });
    mockListMileage.mockResolvedValue(mileage(null));
    await render(<DayEnd />);

    expect(await screen.findByText('nothing was planned')).toBeTruthy();
    expect(screen.queryByText('you went to all of them')).toBeNull();
  });

  it('POSITIVE CONTROL: a day where every planned visit was attended still says so', async () => {
    withStore();
    mockListMileage.mockResolvedValue(mileage(null));
    await render(<DayEnd />);

    expect(await screen.findByText('1 of 1')).toBeTruthy();
    expect(screen.getByText('you went to all of them')).toBeTruthy();
  });
});
