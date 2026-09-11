import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { VisitScreen } from './VisitScreen';
import type { VisitScreenProps } from './VisitScreen';

const props = (over: Partial<VisitScreenProps> = {}): VisitScreenProps => ({
  doctorName: 'Dr S. Iyer',
  clinic: 'Sunrise Clinic, Prabhadevi',
  stage: 'before',
  actionLabel: 'I am here — check in',
  onAction: () => undefined,
  ...over,
});

describe('the action moves with the visit', () => {
  it('offers check-in before it starts', async () => {
    await render(<VisitScreen {...props()} />);
    expect(screen.getByText('I am here — check in')).toBeTruthy();
    expect(screen.getByText('Not started')).toBeTruthy();
  });

  it('offers check-out once checked in', async () => {
    await render(
      <VisitScreen
        {...props({
          stage: 'during',
          actionLabel: 'Leaving — check out',
          startedLabel: 'Checked in 11:56',
        })}
      />,
    );
    expect(screen.getByText('Leaving — check out')).toBeTruthy();
    expect(screen.getByText('Checked in 11:56')).toBeTruthy();
  });

  it('offers nothing once the visit is finished', async () => {
    await render(<VisitScreen {...props({ stage: 'after', actionLabel: null })} />);
    expect(screen.getByText('Visit finished')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fires once when pressed', async () => {
    const onAction = jest.fn();
    await render(<VisitScreen {...props({ onAction })} />);
    await fireEvent.press(screen.getByText('I am here — check in'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('while a position is being taken', () => {
  it('says what it is doing and refuses a second press', async () => {
    // A check-in pressed twice is two check-ins, and the second is an MR in a
    // doorway wondering whether the first worked.
    const onAction = jest.fn();
    await render(<VisitScreen {...props({ busy: true, onAction })} />);
    expect(screen.getByText('Finding your position…')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('when the position cannot be had', () => {
  it('tells the MR which reason it is, and how to fix it', async () => {
    await render(
      <VisitScreen
        {...props({
          blocked:
            'Location is off, so this check-in cannot be sent yet. Turn location on for this app and press again.',
        })}
      />,
    );
    expect(screen.getByText(/Turn location on for this app/u)).toBeTruthy();
  });

  it('does not dress it as a failure of the MR’s', async () => {
    // A phone that cannot see a satellite is a condition with a remedy, not an
    // error. §02 reserves critical for genuine failures.
    await render(
      <VisitScreen {...props({ blocked: 'The phone could not find your position.' })} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(screen.getByText('This check-in cannot be sent yet')).toBeTruthy();
  });

  it('leaves the action pressable so the MR can try again', async () => {
    const onAction = jest.fn();
    await render(<VisitScreen {...props({ blocked: 'No position yet.', onAction })} />);
    await fireEvent.press(screen.getByText('I am here — check in'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

/**
 * D5 — the declined path, and the design's note is the specification: "Read what
 * is not here."
 */
describe('after the recording question is answered', () => {
  it('acknowledges a decline plainly, with nothing added around it', async () => {
    await render(
      <VisitScreen
        actionLabel="Leaving — check out"
        consent={{ outcome: 'declined', answeredLabel: 'Answered 11:59' }}
        doctorName="Dr. S. Iyer"
        clinic={null}
        onAction={() => undefined}
        stage="during"
      />,
    );

    expect(screen.getByText('Noted — no recording.')).toBeTruthy();
    // No warning colour, no "are you sure", no note about consent rate, no
    // explanation of what was lost. A declined visit is one of three ordinary
    // completions and the screen says so by saying nothing else.
    expect(screen.queryByText(/are you sure/iu)).toBeNull();
    expect(screen.queryByText(/consent rate/iu)).toBeNull();
    expect(screen.queryByText(/unfortunately|sorry|instead/iu)).toBeNull();
  });

  it('tells the MR plainly that a consented visit is still not being recorded', async () => {
    // Recording is FE-W4. An MR who believes audio is being captured will speak as
    // though it were, which is the one thing this screen must not let them do.
    await render(
      <VisitScreen
        actionLabel="Leaving — check out"
        consent={{ outcome: 'consented', answeredLabel: 'Answered 11:58' }}
        doctorName="Dr. S. Iyer"
        clinic={null}
        onAction={() => undefined}
        stage="during"
      />,
    );

    expect(screen.getByText('He agreed to a recording.')).toBeTruthy();
    expect(screen.getByText(/nothing is being captured/iu)).toBeTruthy();
  });

  it('offers the question once, and not after it has been answered', async () => {
    const onAsk = jest.fn();
    await render(
      <VisitScreen
        actionLabel="Leaving — check out"
        consent={{ outcome: 'unasked', onAsk }}
        doctorName="Dr. S. Iyer"
        clinic={null}
        onAction={() => undefined}
        stage="during"
      />,
    );
    await fireEvent.press(screen.getByText('Ask about recording'));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('does not offer it before check-in — there is no visit to record yet', async () => {
    await render(
      <VisitScreen
        actionLabel="I am here — check in"
        consent={{ outcome: 'unasked', onAsk: () => undefined }}
        doctorName="Dr. S. Iyer"
        clinic={null}
        onAction={() => undefined}
        stage="before"
      />,
    );
    expect(screen.queryByText('Ask about recording')).toBeNull();
  });
});

describe('MR-26 B5: a pending stage must not borrow confirmed wording', () => {
  /**
   * The rule this enforces is the one MR-26 Part B is careful not to break. The client may
   * ACT on a write it watched itself queue; it may not DESCRIBE that write in the words it
   * uses for one the server has acknowledged.
   *
   * Both directions are asserted, because either lie is believed just as readily: a pending
   * stage claiming confirmation, and a confirmed stage hedged into uselessness.
   */
  it('says "waiting to send" when the check-in is only queued', async () => {
    await render(<VisitScreen {...props({ stage: 'during', stagePending: true })} />);
    expect(screen.getByText(/waiting to send/i)).toBeTruthy();
    // The confirmed sentence asserts a server fact the server has not given.
    expect(screen.queryByText('You are checked in')).toBeNull();
  });

  it('THE POSITIVE CONTROL: says "You are checked in" when the server HAS confirmed it', async () => {
    // Without this, hedging every stage would satisfy the case above while telling an MR
    // whose write landed ten minutes ago that it is still waiting. That is the same defect
    // pointing the other way.
    await render(<VisitScreen {...props({ stage: 'during' })} />);
    expect(screen.getByText('You are checked in')).toBeTruthy();
    expect(screen.queryByText(/waiting to send/i)).toBeNull();
  });

  it('marks a queued CHECK-OUT as pending too, not just the arrival', async () => {
    await render(
      <VisitScreen {...props({ stage: 'after', stagePending: true, actionLabel: null })} />,
    );
    expect(screen.getByText(/waiting to send/i)).toBeTruthy();
    expect(screen.queryByText('Visit finished')).toBeNull();
  });

  it('leaves `before` alone — nothing has been queued, so nothing is pending', async () => {
    // `before` has a pending entry only so the lookup is total. If it ever started saying
    // "waiting to send" it would be announcing a write that does not exist.
    await render(<VisitScreen {...props({ stage: 'before', stagePending: true })} />);
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.queryByText(/waiting to send/i)).toBeNull();
  });
});

describe('MR-26 B4: the blocked banner names the write the MR actually attempted', () => {
  /**
   * Found on the emulator: checking OUT with no signal produced "This check-in cannot be sent
   * yet". The title was hardcoded while the detail came from the caller, so the check-out
   * branch could only ever change half the message.
   *
   * That is defect 8's shape a second time -- MR-18 B3 rewrote the call-report copy for
   * exactly this reason, fixed the caller-supplied detail, and left the hardcoded "Report
   * sent" title. A message assembled from a fixed part and a variable part is not fixed by
   * fixing the variable part.
   */
  it('says CHECK-OUT when the MR was checking out', async () => {
    await render(<VisitScreen {...props({ stage: 'during', blocked: 'Saved on this phone.' })} />);
    expect(screen.getByText('This check-out cannot be sent yet')).toBeTruthy();
    expect(screen.queryByText('This check-in cannot be sent yet')).toBeNull();
  });

  it('THE POSITIVE CONTROL: still says CHECK-IN when the MR was checking in', async () => {
    // Without this, flipping the hardcoded string to "check-out" would satisfy the case above
    // and tell an arriving MR their departure failed -- the same lie pointing the other way.
    await render(<VisitScreen {...props({ stage: 'before', blocked: 'Saved on this phone.' })} />);
    expect(screen.getByText('This check-in cannot be sent yet')).toBeTruthy();
    expect(screen.queryByText('This check-out cannot be sent yet')).toBeNull();
  });
});
