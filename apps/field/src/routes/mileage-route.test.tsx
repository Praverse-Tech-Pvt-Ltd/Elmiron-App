import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

/**
 * FE-D3 B5 — the mileage total is never "0.0 km" before the month has been fetched.
 *
 * The route passed `KM(data?.totalDistanceMetres ?? 0)`, so from the moment the screen opened
 * until the server answered, the figure the rep came for read "0.0 km" — the unknown shown as a
 * zero, on the number their claim is calculated from. A real zero from the server is still a zero
 * and still shown.
 *
 * (This screen reads the MOCK today — CR-3. The loading rule is the same either way.)
 */

const mockListMileage = jest.fn<() => Promise<unknown>>();
jest.mock('../api', () => ({
  createClientForScenario: () => ({ listMileage: () => mockListMileage() }),
}));
jest.mock('../sync/pulled-store', () => ({
  usePulledStore: () => ({
    serverTime: '2026-09-20T06:00:00.000Z',
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  }),
}));

import Mileage from '../../app/mileage';

const month = (totalDistanceMetres: number) => ({
  days:
    totalDistanceMetres === 0
      ? []
      : [
          {
            mrId: '22222222-2222-4222-8222-2222222222aa',
            travelDate: '2026-09-12',
            distanceMetres: totalDistanceMetres,
            checkInCount: 3,
          },
        ],
  totalDistanceMetres,
});

beforeEach(() => {
  mockListMileage.mockReset();
});

describe('FE-D3 B5 — mileage: unknown is not zero', () => {
  it('while the month is still being fetched, shows no total — not "0.0 km"', async () => {
    mockListMileage.mockReturnValue(new Promise(() => undefined));
    await render(<Mileage />);

    expect(screen.getByText('Getting your mileage')).toBeTruthy();
    expect(screen.queryByText('0.0 km')).toBeNull();
  });

  it('POSITIVE CONTROL: a month the server says is zero IS shown as zero', async () => {
    mockListMileage.mockResolvedValue(month(0));
    await render(<Mileage />);

    expect(await screen.findByText('0.0 km')).toBeTruthy();
  });

  it('POSITIVE CONTROL: a month with distance shows it', async () => {
    mockListMileage.mockResolvedValue(month(41_300));
    await render(<Mileage />);

    expect((await screen.findAllByText('41.3 km')).length).toBeGreaterThan(0);
  });
});
