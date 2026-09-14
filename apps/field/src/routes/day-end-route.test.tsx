import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { VisitSchema } from '@fieldforce/core';

// Mocked at the client boundary, as the other route tests are: importing the real
// one pulls in `src/config`, which validates EXPO_PUBLIC_* at module load and
// throws under jest.
const mockListVisits = jest.fn<() => Promise<unknown>>();
const mockListMileage = jest.fn<() => Promise<unknown>>();
jest.mock('../api', () => ({
  createClientForScenario: () => ({
    listVisits: mockListVisits,
    listMileage: mockListMileage,
  }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

// FE-W42 C1. The day now comes from the pulled store, and the real module reaches
// `src/config` the same way `../api` does.
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

import DayEnd from '../../app/day-end';

const visit = (over: Record<string, unknown> = {}) =>
  VisitSchema.parse({
    id: '22222222-2222-4222-8222-222222222201',
    mrId: '22222222-2222-4222-8222-2222222222aa',
    doctorId: '22222222-2222-4222-8222-2222222222bb',
    beatPlanId: null,
    clinicAddressId: null,
    status: 'completed',
    notMetReason: null,
    scheduledFor: null,
    startedAt: '2026-08-13T08:55:00+05:30',
    completedAt: '2026-08-13T18:22:00+05:30',
    receivedAt: '2026-08-13T18:22:01+05:30',
    createdAt: '2026-08-13T08:00:00+05:30',
    updatedAt: '2026-08-13T18:22:01+05:30',
    ...over,
  });

beforeEach(() => {
  // Without this, `not.toHaveBeenCalled()` below sees the PREVIOUS case's calls: these
  // doubles are module-scoped and jest does not clear them between tests by default. The
  // case passed alone and failed in sequence, which is the only way that defect shows.
  mockListVisits.mockReset();
  mockListMileage.mockReset();
  mockStore.mockReset();
});

/** A settled store with a territory day, which is what the existing cases assume. */
const withDay = (today: string | null = '2026-08-13') => {
  mockStore.mockReturnValue({ today });
};

describe('app/day-end.tsx — B7', () => {
  it('carries the stop confirmation through from the contract-parsed day', async () => {
    withDay();
    mockListVisits.mockResolvedValue({ items: [visit()] });
    mockListMileage.mockResolvedValue({ days: [], totalDistanceMetres: 48_200 });

    await render(<DayEnd />);

    expect(await screen.findByText('Nothing is being recorded.')).toBeTruthy();
    // Server stamps, sliced — not a duration, and not re-expressed in the
    // handset's timezone.
    expect(screen.getByText('First check-in 08:55')).toBeTruthy();
    expect(screen.getByText('Last check-out 18:22')).toBeTruthy();
    expect(screen.getByText('48.2 km')).toBeTruthy();
  });

  it('keeps the confirmation standing when the day itself cannot be loaded', async () => {
    // C11's whole point: an MR who cannot tell whether tracking stopped kills the
    // app from Recents, and it is then off tomorrow morning too. A network failure
    // must not be allowed to take that answer off the screen.
    withDay();
    mockListVisits.mockRejectedValue(new Error('Network request failed'));
    mockListMileage.mockResolvedValue({ days: [], totalDistanceMetres: 0 });

    await render(<DayEnd />);

    expect(await screen.findByText('Nothing is being recorded.')).toBeTruthy();
    expect(screen.getByText('0 of 0')).toBeTruthy();
  });

  it('keeps the visit counts when only the mileage window is refused', async () => {
    // Settled separately on purpose. A mileage refusal is not a reason to stop
    // telling the MR how many visits they did.
    withDay();
    mockListVisits.mockResolvedValue({ items: [visit()] });
    mockListMileage.mockRejectedValue(new Error('Network request failed'));

    await render(<DayEnd />);

    expect(await screen.findByText('1 of 1')).toBeTruthy();
    expect(screen.getByText(/No distance yet/u)).toBeTruthy();
  });
});

/**
 * `FE-W42` C1/C2 — the day this screen asks the server for.
 *
 * It was `todayIso(new Date())`: the handset for the instant AND local `getDate()` for the
 * calendar. The value below is chosen to EXPOSE that rather than tolerate it.
 */
describe("app/day-end.tsx — FE-W42, the day is the server's", () => {
  it('asks the server for the TERRITORY day, five minutes past IST midnight', async () => {
    // 18:35Z on 30 September is 00:05 IST on 1 October. A build reading the instant in UTC
    // -- which is what the device-clock version did on a phone whose clock is RIGHT --
    // asks for 2026-09-30. The territory has already turned over.
    withDay('2026-10-01');
    mockListVisits.mockResolvedValue({ items: [] });
    mockListMileage.mockResolvedValue({ days: [], totalDistanceMetres: 0 });

    await render(<DayEnd />);

    await screen.findByText('Nothing is being recorded.');
    // Assert the CONTENT of the request, not that a request happened.
    expect(mockListMileage).toHaveBeenCalledWith({
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
    });
  });

  it('with NO server day, asks for nothing and names the missing thing', async () => {
    withDay(null);
    mockListVisits.mockResolvedValue({ items: [] });
    mockListMileage.mockResolvedValue({ days: [], totalDistanceMetres: 0 });

    await render(<DayEnd />);

    expect(await screen.findByText('Could not confirm which day this is')).toBeTruthy();
    // The assertion that fails against any fallback: the screen asked for NO window at all.
    expect(mockListMileage).not.toHaveBeenCalled();
    expect(mockListVisits).not.toHaveBeenCalled();
  });

  it('THE POSITIVE CONTROL: with a day, it still fetches', async () => {
    // Without this, declining unconditionally would satisfy the case above.
    withDay('2026-08-13');
    mockListVisits.mockResolvedValue({ items: [visit()] });
    mockListMileage.mockResolvedValue({ days: [], totalDistanceMetres: 48_200 });

    await render(<DayEnd />);

    await screen.findByText('Nothing is being recorded.');
    expect(mockListMileage).toHaveBeenCalledWith({
      fromDate: '2026-08-13',
      toDate: '2026-08-13',
    });
  });
});
