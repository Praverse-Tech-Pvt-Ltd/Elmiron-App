import { describe, expect, it, jest } from '@jest/globals';
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

import DayEnd from '../../app/day-end';

const visit = (over: Record<string, unknown> = {}) =>
  VisitSchema.parse({
    id: '22222222-2222-4222-8222-222222222201',
    mrId: '22222222-2222-4222-8222-2222222222aa',
    doctorId: '22222222-2222-4222-8222-2222222222bb',
    beatPlanId: null,
    clinicAddressId: null,
    status: 'completed',
    scheduledFor: null,
    startedAt: '2026-08-13T08:55:00+05:30',
    completedAt: '2026-08-13T18:22:00+05:30',
    receivedAt: '2026-08-13T18:22:01+05:30',
    createdAt: '2026-08-13T08:00:00+05:30',
    updatedAt: '2026-08-13T18:22:01+05:30',
    ...over,
  });

describe('app/day-end.tsx — B7', () => {
  it('carries the stop confirmation through from the contract-parsed day', async () => {
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
    mockListVisits.mockRejectedValue(new Error('Network request failed'));
    mockListMileage.mockResolvedValue({ days: [], totalDistanceMetres: 0 });

    await render(<DayEnd />);

    expect(await screen.findByText('Nothing is being recorded.')).toBeTruthy();
    expect(screen.getByText('0 of 0')).toBeTruthy();
  });

  it('keeps the visit counts when only the mileage window is refused', async () => {
    // Settled separately on purpose. A mileage refusal is not a reason to stop
    // telling the MR how many visits they did.
    mockListVisits.mockResolvedValue({ items: [visit()] });
    mockListMileage.mockRejectedValue(new Error('Network request failed'));

    await render(<DayEnd />);

    expect(await screen.findByText('1 of 1')).toBeTruthy();
    expect(screen.getByText(/No distance yet/u)).toBeTruthy();
  });
});
