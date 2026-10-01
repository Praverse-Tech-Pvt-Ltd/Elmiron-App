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
 * FE-D14 — the screen reads the REAL server now, through `daily_mileage` (`listMileage` in
 * `src/capture/visits.ts`), which CR-3 proved an MR may call. The mock client is mocked to throw,
 * so any path back to `127.0.0.1:4010` fails these cases rather than passing quietly.
 */

const mockListMileage = jest.fn<(from: string, to: string) => Promise<unknown>>();
jest.mock('../capture/visits', () => ({
  listMileage: (from: string, to: string) => mockListMileage(from, to),
}));
const mockMockClient = jest.fn(() => {
  throw new Error('FE-D14: the mileage screen must not reach the mock server');
});
jest.mock('../api', () => ({ createClientForScenario: () => mockMockClient() }));
const mockStore = jest.fn();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => mockStore() }));

import Mileage from '../../app/mileage';

const MR = '22222222-2222-4222-8222-2222222222aa';
const day = (travelDate: string, distanceMetres: number) => ({
  mrId: MR,
  travelDate,
  distanceMetres,
  checkInCount: 3,
});
const loaded = (days: readonly ReturnType<typeof day>[]) => ({ kind: 'loaded', days });

beforeEach(() => {
  mockListMileage.mockReset();
  mockMockClient.mockClear();
  mockStore.mockReset();
  mockStore.mockReturnValue({
    serverTime: '2026-09-20T06:00:00.000Z',
    zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
  });
});

describe('FE-D3 B5 — mileage: unknown is not zero', () => {
  it('while the month is still being fetched, shows no total — not "0.0 km"', async () => {
    mockListMileage.mockReturnValue(new Promise(() => undefined));
    await render(<Mileage />);

    expect(screen.getByText('Getting your mileage')).toBeTruthy();
    expect(screen.queryByText('0.0 km')).toBeNull();
  });

  it('POSITIVE CONTROL: a month the server says is zero IS shown as zero', async () => {
    mockListMileage.mockResolvedValue(loaded([]));
    await render(<Mileage />);

    expect(await screen.findByText('0.0 km')).toBeTruthy();
  });

  it('POSITIVE CONTROL: a month with distance shows it', async () => {
    mockListMileage.mockResolvedValue(loaded([day('2026-09-12', 41_300)]));
    await render(<Mileage />);

    expect((await screen.findAllByText('41.3 km')).length).toBeGreaterThan(0);
  });
});

describe('FE-D14 — mileage reads the real server', () => {
  it('asks daily_mileage for the territory month, and never the mock', async () => {
    mockListMileage.mockResolvedValue(loaded([]));
    await render(<Mileage />);
    await screen.findByText('0.0 km');

    expect(mockListMileage).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    expect(mockMockClient).not.toHaveBeenCalled();
  });

  it('the month total is the sum of the days the server sent, labelled by travel date', async () => {
    mockListMileage.mockResolvedValue(
      loaded([day('2026-09-12', 41_300), day('2026-09-13', 12_000)]),
    );
    await render(<Mileage />);

    expect(await screen.findByText('53.3 km')).toBeTruthy();
    expect(screen.getByText('12 Sep')).toBeTruthy();
    expect(screen.getByText('13 Sep')).toBeTruthy();
  });

  it('a refusal is a failure state, not an empty month', async () => {
    mockListMileage.mockResolvedValue({
      kind: 'refused',
      refusal: { code: 'not_permitted', sqlState: '42501', actionable: false },
    });
    await render(<Mileage />);

    expect(await screen.findByText('You do not have access to this mileage')).toBeTruthy();
    expect(screen.queryByText('0.0 km')).toBeNull();
  });

  it('an unreachable server is a failure state, not an empty month', async () => {
    mockListMileage.mockRejectedValue(new Error('Network request failed'));
    await render(<Mileage />);

    expect(await screen.findByText('Could not load your mileage')).toBeTruthy();
    expect(screen.queryByText('0.0 km')).toBeNull();
  });

  it('with no server clock, asks for nothing', async () => {
    mockStore.mockReturnValue({
      serverTime: null,
      zone: { timeZone: 'Asia/Kolkata', source: 'territory' },
    });
    await render(<Mileage />);

    expect(await screen.findByText('Could not tell which month to show')).toBeTruthy();
    expect(mockListMileage).not.toHaveBeenCalled();
  });
});
