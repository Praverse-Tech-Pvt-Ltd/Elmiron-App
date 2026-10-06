import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { MileageScreen } from './MileageScreen';

/**
 * W2-B B3 — "5 Oct — 0.0 km · 1 check-ins", on the emulator on 5 October.
 *
 * This screen had no render test of its own: the route test mocks the data and asserts the total,
 * so the row's own sentence was never read by anything until a person looked at it.
 */
const day = (checkInCount: number) => ({
  id: `d${String(checkInCount)}`,
  dateLabel: `${String(checkInCount)} Oct`,
  distanceLabel: '0.0 km',
  checkInCount,
});

describe('MileageScreen — the day row counts check-ins in English', () => {
  it('one is singular', async () => {
    await render(<MileageScreen days={[day(1)]} rateNote="" totalLabel="0.0 km" />);
    expect(screen.getByText('0.0 km · 1 check-in')).toBeTruthy();
  });

  it('none and many are plural', async () => {
    await render(<MileageScreen days={[day(0), day(2)]} rateNote="" totalLabel="0.0 km" />);
    expect(screen.getByText('0.0 km · 0 check-ins')).toBeTruthy();
    expect(screen.getByText('0.0 km · 2 check-ins')).toBeTruthy();
  });
});
