import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TransparencyScreen } from './TransparencyScreen';
import type { TransparencyEntry } from './TransparencyScreen';

const entries: readonly TransparencyEntry[] = [
  {
    title: 'Where you are, during your shift',
    detail: 'Start day to End day. Never outside those hours.',
    state: 'not-yet',
  },
  { title: 'Which doctors you saw, and when', detail: 'Check-in times.', state: 'active' },
];

const NEVER = 'Your personal calls, messages, other apps, your camera.';

describe('the screen states what is true, not what is planned', () => {
  it('marks a capability that does not exist yet as not yet', async () => {
    // The failure this prevents: an MR reading "Where you are, during your shift"
    // and concluding they are already being tracked by a build that takes no
    // position fix at all. On this screen that is the worst possible error.
    await render(<TransparencyScreen entries={entries} neverRecorded={NEVER} />);
    expect(screen.getByText('Not yet — this app cannot do this today.')).toBeTruthy();
  });

  it('does not add that line to something the app really does', async () => {
    await render(<TransparencyScreen entries={entries} neverRecorded={NEVER} />);
    expect(screen.getAllByText('Not yet — this app cannot do this today.').length).toBe(1);
  });

  it('carries a preamble when the honest answer differs from the list', async () => {
    await render(
      <TransparencyScreen
        entries={entries}
        neverRecorded={NEVER}
        preamble="Right now this app records nothing new about you."
      />,
    );
    expect(screen.getByText('Right now this app records nothing new about you.')).toBeTruthy();
  });
});

describe('the never block', () => {
  it('renders the sentence verbatim rather than summarising it', async () => {
    // The design's note: this block matters more than the list above it, because
    // field-force fear is about the phone in a pocket after 7pm. Paraphrasing it
    // is how the one sentence that answers that fear gets softened.
    await render(<TransparencyScreen entries={entries} neverRecorded={NEVER} />);
    expect(screen.getByText(NEVER)).toBeTruthy();
    expect(screen.getByText('What we never record')).toBeTruthy();
  });
});

describe('the continue action', () => {
  it('is offered when first-run passes through here', async () => {
    const onContinue = jest.fn();
    await render(
      <TransparencyScreen entries={entries} neverRecorded={NEVER} onContinue={onContinue} />,
    );
    await fireEvent.press(screen.getByText('Start my first day'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('is absent when the MR opened this mid-shift from home', async () => {
    // C10 makes this reachable any time. A button restarting onboarding on a screen
    // opened at 14:00 would be a trap.
    await render(<TransparencyScreen entries={entries} neverRecorded={NEVER} />);
    expect(screen.queryByText('Start my first day')).toBeNull();
  });
});
