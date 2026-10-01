import { describe, expect, it } from 'vitest';
import { totalDistanceMetres, travelDateLabel } from './mileage';

const MR = '22222222-2222-4222-8222-2222222222aa';
const day = (travelDate: string, distanceMetres: number) => ({
  mrId: MR,
  travelDate,
  distanceMetres,
  checkInCount: 2,
});

describe('FE-D14 — mileage from daily_mileage', () => {
  it('totals the distances the server sent', () => {
    expect(totalDistanceMetres([day('2026-09-12', 41_300), day('2026-09-13', 12_000)])).toBe(
      53_300,
    );
  });

  it('a month with no rows is a real zero', () => {
    expect(totalDistanceMetres([])).toBe(0);
  });

  it('labels a travel date off its characters, with no zone applied', () => {
    expect(travelDateLabel('2026-09-01')).toBe('1 Sep');
    expect(travelDateLabel('2026-12-31')).toBe('31 Dec');
  });
});
