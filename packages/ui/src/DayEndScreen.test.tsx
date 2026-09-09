import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DayEndScreen } from './DayEndScreen';

const noop = (): void => undefined;

const props = {
  dayLabel: 'Thursday',
  firstCaptureLabel: 'First check-in 08:55',
  lastCaptureLabel: 'Last check-out 18:22',
  captureNote:
    'This app only ever reads your position at the moment you press check in or check out.',
  planned: 9,
  done: 9,
  notMet: 0,
  distanceLabel: '48.2 km',
  rateNote: 'Distance only. Your rate per kilometre is set by your company.',
  sync: { kind: 'idle', at: null } as const,
  onOpenQueue: noop,
  onOpenTransparency: noop,
};

describe('C11 — the stop confirmation outranks the day’s numbers', () => {
  it('states that nothing is being recorded, and why', async () => {
    await render(<DayEndScreen {...props} />);
    expect(screen.getByText('Nothing is being recorded.')).toBeTruthy();
    expect(screen.getByText(props.captureNote)).toBeTruthy();
  });

  it('keeps the confirmation up while the totals are still loading', async () => {
    // The moment C11 is about: an MR with no signal must not be left watching a
    // spinner while wondering whether they are still being tracked.
    await render(<DayEndScreen {...props} loading planned={0} done={0} distanceLabel={null} />);
    expect(screen.getByText('Nothing is being recorded.')).toBeTruthy();
  });
});

describe('the three numbers B7 draws that this screen refuses to invent', () => {
  it('shows no rupee figure, and names why there is none', async () => {
    await render(<DayEndScreen {...props} />);
    expect(screen.queryByText(/₹/u)).toBeNull();
    expect(screen.getByText(props.rateNote)).toBeTruthy();
  });

  it('shows the two server stamps rather than a duration between them', async () => {
    await render(<DayEndScreen {...props} />);
    expect(screen.getByText('First check-in 08:55')).toBeTruthy();
    expect(screen.getByText('Last check-out 18:22')).toBeTruthy();
    // "ran 9h 27m" is the figure being refused.
    expect(screen.queryByText(/\d+h \d+m/u)).toBeNull();
  });

  it('reports no data usage, because nothing in this app measures it', async () => {
    await render(<DayEndScreen {...props} />);
    expect(screen.queryByText(/MB/u)).toBeNull();
  });
});

describe('the day’s totals', () => {
  it('counts visits as B1 counts them', async () => {
    await render(<DayEndScreen {...props} done={7} />);
    expect(screen.getByText('7 of 9')).toBeTruthy();
  });

  it('says the distance is absent rather than showing a zero', async () => {
    // A zero would read as "you travelled nowhere today", which is a different
    // claim from "the server has not computed a distance for this day".
    await render(<DayEndScreen {...props} distanceLabel={null} />);
    expect(screen.getByText(/No distance yet/u)).toBeTruthy();
  });
});

describe('the way out', () => {
  it('offers the transparency screen and nothing that pretends to start a day', async () => {
    const onOpenTransparency = jest.fn();
    await render(<DayEndScreen {...props} onOpenTransparency={onOpenTransparency} />);

    expect(screen.queryByText(/Start day/u)).toBeNull();
    await fireEvent.press(screen.getByText('See everything recorded today'));
    expect(onOpenTransparency).toHaveBeenCalledTimes(1);
  });

  it('replaces the screen with a denial, which says something different', async () => {
    await render(
      <DayEndScreen
        {...props}
        failure={{ title: 'You do not have access to this day', detail: 'Denied by the server.' }}
      />,
    );
    expect(screen.getByText('You do not have access to this day')).toBeTruthy();
    expect(screen.queryByText('Nothing is being recorded.')).toBeNull();
  });
});
