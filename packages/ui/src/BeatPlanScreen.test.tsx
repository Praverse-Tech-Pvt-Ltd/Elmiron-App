import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BeatPlanScreen } from './BeatPlanScreen';
import type { BeatPlanStop } from './BeatPlanScreen';

const stops: readonly BeatPlanStop[] = [
  {
    id: 'a',
    doctorName: 'Dr A. Menon',
    clinic: 'Sion Clinic, Sion',
    state: 'done',
    detail: '09:20 · consented · 8 min',
  },
  {
    id: 'b',
    doctorName: 'Dr S. Iyer',
    clinic: 'Sunrise Clinic, Prabhadevi',
    state: 'current',
    detail: '',
  },
  { id: 'c', doctorName: 'Dr K. Shah', clinic: 'Matunga', state: 'upcoming', detail: '' },
];

describe('the route is a timeline', () => {
  it('counts the day in the header', async () => {
    await render(<BeatPlanScreen done={1} planned={3} stops={stops} />);
    expect(screen.getByText('3 planned · 1 done')).toBeTruthy();
  });

  it('renders every stop, done and still to come', async () => {
    await render(<BeatPlanScreen done={1} planned={3} stops={stops} />);
    expect(screen.getByText('Dr A. Menon')).toBeTruthy();
    expect(screen.getByText('Dr S. Iyer')).toBeTruthy();
    expect(screen.getByText('Dr K. Shah')).toBeTruthy();
  });

  it('gives the current stop the only card, and labels it', async () => {
    // B3's rule. A screen with three cards has told the MR nothing about which one
    // to walk to, so "Next stop" appears exactly once.
    await render(<BeatPlanScreen done={1} planned={3} stops={stops} />);
    expect(screen.getAllByText('Next stop').length).toBe(1);
  });

  it('keeps what happened at a finished stop on the row', async () => {
    await render(<BeatPlanScreen done={1} planned={3} stops={stops} />);
    expect(screen.getByText('09:20 · consented · 8 min')).toBeTruthy();
  });

  it('says a stop has not started rather than leaving the line blank', async () => {
    await render(<BeatPlanScreen done={1} planned={3} stops={stops} />);
    expect(screen.getByText('Not started')).toBeTruthy();
  });

  it('opens the doctor that was pressed', async () => {
    const onOpen = jest.fn();
    await render(<BeatPlanScreen done={1} onOpenDoctor={onOpen} planned={3} stops={stops} />);
    await fireEvent.press(screen.getByText('Dr K. Shah'));
    expect(onOpen).toHaveBeenCalledWith('c');
  });
});

describe('a day with no plan', () => {
  it('reads as an ordinary day, not as a failure', async () => {
    await render(<BeatPlanScreen done={0} planned={0} stops={[]} />);
    expect(screen.getByText('No route for today')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    // Same rule as S2: never hand the MR's day to somebody else.
    expect(screen.queryByText(/manager/iu)).toBeNull();
  });
});

describe('a refused route', () => {
  it('shows the denial instead of an empty timeline', async () => {
    await render(
      <BeatPlanScreen
        done={0}
        failure={{ title: 'You do not have access to this plan', detail: 'Not your territory.' }}
        planned={0}
        stops={[]}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No route for today')).toBeNull();
  });
});

describe('MR-45 BE-W89 — the plan says what state it is in', () => {
  it('shows the status line under the heading', async () => {
    await render(
      <BeatPlanScreen
        done={0}
        planned={3}
        statusLine="Submitted — not yet approved"
        stops={stops}
      />,
    );
    expect(screen.getByText('Submitted — not yet approved')).toBeTruthy();
    // The route still renders beneath it: a status is information about the plan, not a
    // replacement for it.
    expect(screen.getByText('Dr A. Menon')).toBeTruthy();
  });

  it('shows no status line when there is no plan to describe', async () => {
    await render(<BeatPlanScreen done={0} planned={0} stops={[]} />);
    expect(screen.queryByText(/approved/iu)).toBeNull();
  });
});

describe('MR-45 BE-W89 B4 — a plan whose stops are still arriving', () => {
  const syncing = {
    title: 'Your stops are still syncing',
    detail: 'Your plan arrived; its stops have not yet.',
  };

  it('says the stops are syncing', async () => {
    await render(
      <BeatPlanScreen
        done={0}
        notice={syncing}
        planned={0}
        statusLine="Submitted — not yet approved"
        stops={[]}
      />,
    );
    expect(screen.getByText('Your stops are still syncing')).toBeTruthy();
  });

  it('does NOT also say no plan came through — the absence is the point', async () => {
    // The defect this screen was held on the mock for: the only empty state was "No beat
    // plan came through", which is false when a plan DID come through and its stops have
    // not. A presence check on the notice would pass while this sentence sat beneath it.
    await render(<BeatPlanScreen done={0} notice={syncing} planned={0} stops={[]} />);
    expect(screen.queryByText('No route for today')).toBeNull();
    expect(screen.queryByText(/No beat plan came through/u)).toBeNull();
  });
});
