import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TodayScreen } from './TodayScreen';
import type { TodayScreenProps } from './TodayScreen';

const props = (over: Partial<TodayScreenProps> = {}): TodayScreenProps => ({
  dayLabel: 'Today',
  startedLabel: 'Started 08:55',
  planned: 9,
  done: 6,
  next: { doctorName: 'Dr S. Iyer', clinic: 'Sunrise Clinic, Prabhadevi', scheduledLabel: null },
  sync: { kind: 'idle', at: null },
  onOpenQueue: () => undefined,
  ...over,
});

describe('the day', () => {
  it('leads with the next visit and names where it is', async () => {
    await render(<TodayScreen {...props()} />);
    expect(screen.getByText('Dr S. Iyer')).toBeTruthy();
    expect(screen.getByText('Sunrise Clinic, Prabhadevi')).toBeTruthy();
  });

  it('shows progress as done against planned', async () => {
    await render(<TodayScreen {...props()} />);
    expect(screen.getByText('6 of 9')).toBeTruthy();
  });

  it('offers the single primary action, named for where it sends the MR', async () => {
    const onStart = jest.fn();
    await render(<TodayScreen {...props({ onStartNextVisit: onStart })} />);
    await fireEvent.press(screen.getByText('Start the visit to Dr S. Iyer'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe('a finished day is not an empty one', () => {
  it('says the work is done rather than showing a blank screen', async () => {
    // The difference matters: "nothing here" reads as a broken app to someone who
    // has just walked nine clinics.
    await render(<TodayScreen {...props({ next: null, done: 9 })} />);
    expect(screen.getByText("That's the day done")).toBeTruthy();
    expect(screen.queryByText(/^Start the visit/u)).toBeNull();
  });

  it('distinguishes a day with no plan from a day that was worked through', async () => {
    await render(<TodayScreen {...props({ next: null, planned: 0, done: 0 })} />);
    expect(screen.getByText('Nothing planned for today')).toBeTruthy();
    // An unplanned visit is legitimate, so this is not phrased as an error either.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never tells the MR to go and ask their manager for a plan', async () => {
    // S2's explicit instruction. That sentence hands the MR's day to somebody else
    // and leaves them standing still; the screen offers the next useful thing
    // instead.
    await render(<TodayScreen {...props({ next: null, planned: 0, done: 0 })} />);
    expect(screen.queryByText(/manager/iu)).toBeNull();
    expect(screen.getByText(/still visit anyone in your territory/u)).toBeTruthy();
  });

  it('offers somewhere useful to go when no plan arrived', async () => {
    const onFind = jest.fn();
    await render(
      <TodayScreen {...props({ next: null, planned: 0, done: 0, onFindDoctor: onFind })} />,
    );
    await fireEvent.press(screen.getByText('Find a doctor'));
    expect(onFind).toHaveBeenCalledTimes(1);
  });
});

describe('the states that are not the day', () => {
  it('never blocks the day behind a spinner while it loads', async () => {
    // S1's rule, and the reason it is a rule: "a blocking spinner in a waiting room
    // is a lost visit". Whatever is already known stays on screen and stays
    // interactive underneath the progress line.
    await render(<TodayScreen {...props({ loading: true })} />);
    expect(screen.getByLabelText("Getting today's plan")).toBeTruthy();
    expect(screen.getByText('Dr S. Iyer')).toBeTruthy();
    expect(screen.getByText('6 of 9')).toBeTruthy();
  });

  it('does not claim "0 of 0" for a day it has not loaded yet', async () => {
    // The other half: with nothing known, the count is absent rather than zero.
    // "0 of 0" is a statement about the MR's work, and it would be false.
    await render(<TodayScreen {...props({ loading: true, next: null, planned: 0, done: 0 })} />);
    expect(screen.getByLabelText("Getting today's plan")).toBeTruthy();
    expect(screen.queryByText('0 of 0')).toBeNull();
    expect(screen.queryByText('Nothing planned for today')).toBeNull();
  });

  it('shows a denial as a denial and never as an empty day', async () => {
    await render(
      <TodayScreen
        {...props({
          failure: {
            title: 'You do not have access to this plan',
            detail: 'This plan belongs to another medical representative.',
          },
        })}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('6 of 9')).toBeNull();
  });
});

describe('the transparency link', () => {
  it('is present when there is a screen behind it', async () => {
    const onOpen = jest.fn();
    await render(<TodayScreen {...props({ onOpenTransparency: onOpen })} />);
    await fireEvent.press(screen.getByText('What this app records about me'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is absent rather than pointing somewhere else when there is not', async () => {
    // C10 puts this one tap from home. Until the screen exists, no row is honest;
    // a row aimed at the queue would make the transparency promise the first thing
    // the app breaks.
    await render(<TodayScreen {...props()} />);
    expect(screen.queryByText('What this app records about me')).toBeNull();
  });
});
