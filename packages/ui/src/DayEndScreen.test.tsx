import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
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

describe('FE-D7 4 — how the screen reads', () => {
  it('heads the totals "Your day", never "Your Today"', async () => {
    // The route passes "Today", and "Your ${dayLabel}" made it "Your Today".
    await render(<DayEndScreen {...props} dayLabel="Today" />);
    expect(screen.queryByText('Your Today')).toBeNull();
    expect(screen.getByText('Your day')).toBeTruthy();
  });

  it('offers "See everything recorded today" as a secondary button, as B7 draws it', async () => {
    await render(<DayEndScreen {...props} />);
    const button = screen.getByRole('button', { name: 'See everything recorded today' });
    expect(
      (StyleSheet.flatten(button.props['style']) as { backgroundColor?: string }).backgroundColor,
    ).toBe(tokens.color.wash);
  });

  it('titles the screen at the design’s 27px day-screen title, not the section heading', async () => {
    await render(<DayEndScreen {...props} dayLabel="Today" />);
    const title = StyleSheet.flatten(screen.getByText("Today — that's the day").props['style']) as {
      fontSize?: number;
    };
    expect(title.fontSize).toBe(tokens.typography.title.size);
  });
});

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
    //
    // FE-D3 B4 — corrected. This asserted "No distance yet … once you have checked into more
    // than one visit". A null distance with loading finished only ever means the fetch FAILED (a
    // real zero arrives as a number), so that sentence gave a false reason. It now says the
    // distance is not available.
    await render(<DayEndScreen {...props} distanceLabel={null} />);
    expect(screen.getByText(/Distance not available/u)).toBeTruthy();
    expect(screen.queryByText(/No distance yet/u)).toBeNull();
  });

  it('FE-D3 B4: while loading, claims nothing about the distance', async () => {
    await render(<DayEndScreen {...props} loading distanceLabel={null} />);
    expect(screen.queryByText(/No distance yet/u)).toBeNull();
    expect(screen.queryByText(/Distance not available/u)).toBeNull();
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

describe('FE-W80 — the working day and "End my day"', () => {
  const open = {
    title: 'Your day is open — started 08:55',
    detail: 'When you end it, the server keeps your day as it stands.',
    tone: 'plain' as const,
    note: { value: '', onChange: noop },
    action: { label: 'End my day', onPress: noop, busy: false, blockedBy: null },
  };

  it('draws no card when there is no working day to speak of', async () => {
    await render(<DayEndScreen {...props} />);
    expect(screen.queryByText('Your working day')).toBeNull();
    expect(screen.queryByText('End my day')).toBeNull();
  });

  it('draws the server’s word on the day, the note, and the button that ends it', async () => {
    const onPress = jest.fn();
    await render(
      <DayEndScreen {...props} workDay={{ ...open, action: { ...open.action, onPress } }} />,
    );
    expect(screen.getByText('Your day is open — started 08:55')).toBeTruthy();
    expect(screen.getByLabelText('Note for your manager')).toBeTruthy();
    await fireEvent.press(screen.getByText('End my day'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a button that cannot be pressed says why, and does nothing', async () => {
    const onPress = jest.fn();
    await render(
      <DayEndScreen
        {...props}
        workDay={{
          ...open,
          action: { ...open.action, onPress, blockedBy: 'A visit is still checked in.' },
        }}
      />,
    );
    expect(screen.getByText('A visit is still checked in.')).toBeTruthy();
    await fireEvent.press(screen.getByText('End my day'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps the stop confirmation FIRST: the day card comes after it (C11)', async () => {
    await render(<DayEndScreen {...props} workDay={open} />);
    // The rendered tree, serialised in document order: the confirmation's text comes first.
    const order = JSON.stringify(screen.toJSON());
    const stop = order.indexOf('Nothing is being recorded.');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(order.indexOf('Your day is open — started 08:55'));
  });

  it('an ended day offers no button and no note', async () => {
    await render(
      <DayEndScreen
        {...props}
        workDay={{
          title: 'Day ended at 18:22',
          detail: 'The server has your day.',
          tone: 'done',
          note: null,
          action: null,
        }}
      />,
    );
    expect(screen.getByText('Day ended at 18:22')).toBeTruthy();
    expect(screen.queryByText('End my day')).toBeNull();
    expect(screen.queryByLabelText('Note for your manager')).toBeNull();
  });

  it('a refusal is drawn as an alert, with what to do', async () => {
    await render(
      <DayEndScreen
        {...props}
        workDay={{
          ...open,
          title: 'Your day was not ended',
          detail: 'A visit is still checked in. Check out of it, then end your day again.',
          tone: 'refused',
        }}
      />,
    );
    expect(screen.getByText('Your day was not ended')).toBeTruthy();
    expect(screen.getByText(/Check out of it, then end your day again/u)).toBeTruthy();
    expect(screen.getByText('End my day')).toBeTruthy();
  });
});
