import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { AdverseEventScreen } from './AdverseEventScreen';
import { CallReportScreen } from './CallReportScreen';
import { DoctorProfileScreen } from './DoctorProfileScreen';
import { VisitScreen } from './VisitScreen';
import type { VisitScreenProps } from './VisitScreen';
import { VoiceNoteScreen } from './VoiceNoteScreen';
import type { VoiceNoteScreenProps } from './VoiceNoteScreen';

/**
 * Handover polish, round 2 — the visit and what follows it (`FE-W186`, `FE-W188`, `FE-W189`,
 * `FE-W190`). Each block names the QA screenshot that showed the problem.
 */
type Node = ReturnType<typeof screen.getByText>;

const flat = (node: Node | null): Record<string, unknown> =>
  Object.assign(
    {},
    StyleSheet.flatten(node?.props['style'] as Parameters<typeof StyleSheet.flatten>[0]),
  );

/** True when no ancestor of the node is a ScrollView's content: it is pinned, not scrolled to. */
const pinned = (node: Node): boolean => {
  let at: Node | null = node.parent;
  while (at !== null) {
    if (at.props['contentContainerStyle'] !== undefined) return false;
    at = at.parent;
  }
  return true;
};

const visit = (over: Partial<VisitScreenProps> = {}): VisitScreenProps => ({
  doctorName: 'Dr S. Iyer',
  clinic: 'Sunrise Clinic, Prabhadevi',
  stage: 'during',
  actionLabel: 'Leaving — check out',
  onAction: () => undefined,
  ...over,
});

describe('the visit’s steps hold their width (FE-W190, QA 19 and 39)', () => {
  it('draws four cells of one flexible width, whatever their state', async () => {
    await render(<VisitScreen {...visit({ stage: 'after', actionLabel: null })} />);
    const cells = ['Check in', 'With the doctor', 'Check out', 'Report'].map(
      (label) => screen.getByText(label).parent,
    );
    for (const cell of cells) expect(flat(cell)['flex']).toBe(1);
    // The tick is drawn, never written: no "✓ " is added to a label to widen it.
    expect(screen.queryByText(/✓/u)).toBeNull();
  });

  it('says which steps are done and which is now, to a screen reader', async () => {
    await render(<VisitScreen {...visit()} />);
    expect(screen.getByLabelText('Check in: done')).toBeTruthy();
    expect(screen.getByLabelText('With the doctor: now')).toBeTruthy();
    expect(screen.getByLabelText('Report')).toBeTruthy();
  });

  it('marks the current step with the accent’s own wash and edge, not the info blue', async () => {
    await render(<VisitScreen {...visit()} />);
    const now = flat(screen.getByText('With the doctor').parent);
    expect(now['backgroundColor']).toBe(tokens.color.successFill);
    expect(now['borderColor']).toBe(tokens.color.accent);
    expect(now['backgroundColor']).not.toBe(tokens.color.infoFill);
  });
});

describe('one checked-in line (FE-W190, QA 19)', () => {
  it('a confirmed check-in with its time is said once', async () => {
    await render(<VisitScreen {...visit({ startedLabel: 'Checked in 15:29' })} />);
    expect(screen.getByText('Checked in 15:29')).toBeTruthy();
    expect(screen.queryByText('You are checked in')).toBeNull();
  });

  it('keeps the stage’s words when they add something: waiting to send', async () => {
    await render(<VisitScreen {...visit({ stagePending: true })} />);
    expect(screen.getByText('Checked in — waiting to send')).toBeTruthy();
  });
});

describe('Back on the visit screens (FE-W188)', () => {
  it('the visit draws Back when the route gives it, and not otherwise', async () => {
    const onBack = jest.fn();
    await render(<VisitScreen {...visit({ onBack })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    await render(<VisitScreen {...visit()} />);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('the call report draws Back too', async () => {
    const onBack = jest.fn();
    await render(
      <CallReportScreen
        dateLabel="14 Oct"
        doctorName="Dr S. Iyer"
        nextStep=""
        objections=""
        onBack={onBack}
        onNextStepChange={() => undefined}
        onObjectionsChange={() => undefined}
        onSend={() => undefined}
        onSummaryChange={() => undefined}
        summary=""
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('the call report’s words (FE-W190, QA 40 and 41)', () => {
  it('does not count the optional fields wrongly, or repeat the label as its help', async () => {
    await render(
      <CallReportScreen
        dateLabel="14 Oct"
        doctorName="Dr S. Iyer"
        nextStep=""
        objections=""
        onNextStepChange={() => undefined}
        onObjectionsChange={() => undefined}
        onSend={() => undefined}
        onSummaryChange={() => undefined}
        summary=""
      />,
    );
    // Three other fields and a product list: "the other two" was wrong.
    expect(screen.queryByText(/other two/u)).toBeNull();
    expect(
      screen.getByText('Write what happened first. Everything else is optional.'),
    ).toBeTruthy();
    expect(screen.queryByText('What happened, in your words.')).toBeNull();
  });
});

describe('the voice note (FE-W190, QA 33)', () => {
  const base: VoiceNoteScreenProps = {
    elapsed: '00:00',
    hint: 'Try covering what they asked.',
    onHoldEnd: () => undefined,
    onHoldStart: () => undefined,
    onStartAgain: () => undefined,
    prompt: 'What should I put in the report?',
    recording: false,
    subject: 'Your note',
  };

  it('offers "Start again" only once there is something to start again from', async () => {
    await render(<VoiceNoteScreen {...base} />);
    expect(screen.queryByText('Start again')).toBeNull();

    await render(<VoiceNoteScreen {...base} elapsed="00:04" onSave={() => undefined} />);
    expect(screen.getByText('Start again')).toBeTruthy();
    expect(screen.getByText('Save this note')).toBeTruthy();
  });

  it('pins the hold control in the footer, under the thumb', async () => {
    await render(<VoiceNoteScreen {...base} />);
    expect(pinned(screen.getByLabelText('Hold to record your note'))).toBe(true);
  });

  it('labels it in the control role, semibold, in ink', async () => {
    await render(<VoiceNoteScreen {...base} />);
    const label = flat(screen.getByText('Hold to record'));
    expect(label['fontWeight']).toBe(tokens.typography.control.weight);
    expect(label['fontSize']).toBe(tokens.typography.control.size);
    expect(label['color']).toBe(tokens.color.textPrimary);
  });

  it('starts its status line with a capital', async () => {
    await render(<VoiceNoteScreen {...base} />);
    expect(screen.getByText('Hold the button below to start')).toBeTruthy();
  });

  it('draws Back when the route gives it', async () => {
    const onBack = jest.fn();
    await render(<VoiceNoteScreen {...base} onBack={onBack} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('flagging a side effect (FE-W190, QA 34)', () => {
  it('takes several lines, and pins Send in the footer', async () => {
    await render(
      <AdverseEventScreen
        doctorName="Dr S. Iyer"
        onSend={() => undefined}
        onTextChange={() => undefined}
        text="Rash after the second dose."
      />,
    );
    expect(screen.getByLabelText('What happened').props['multiline']).toBe(true);
    expect(pinned(screen.getByText('Send the flag'))).toBe(true);
  });
});

describe('a doctor’s profile (FE-W190, QA 21)', () => {
  const profile = {
    name: 'Dr Asha Deshpande',
    detail: 'Urology · Main clinic, Pune',
    sinceLabel: null,
    recentVisits: [],
    boundary: 'Nothing here about what they prescribe, and nothing about their patients.',
  };

  it('names the doctor as the screen’s title', async () => {
    await render(<DoctorProfileScreen {...profile} />);
    expect(flat(screen.getByText('Dr Asha Deshpande'))['fontSize']).toBe(
      tokens.typography.title.size,
    );
  });

  it('draws the privacy note as a quiet note, not as work waiting offline', async () => {
    await render(<DoctorProfileScreen {...profile} />);
    let node: Node | null = screen.getByText(profile.boundary).parent;
    let dashed = false;
    while (node !== null) {
      if (flat(node)['borderStyle'] === 'dashed') dashed = true;
      node = node.parent;
    }
    expect(dashed).toBe(false);
  });

  it('does not say "not visited yet" to a rep checked in with the doctor for the first time', async () => {
    await render(<DoctorProfileScreen {...profile} inVisitNow />);
    expect(
      screen.getByText('You are with this doctor now. This is your first visit.'),
    ).toBeTruthy();
    expect(screen.queryByText('You have not visited this doctor yet.')).toBeNull();
  });

  it('THE POSITIVE CONTROL: still says it when there is no visit at all', async () => {
    await render(<DoctorProfileScreen {...profile} />);
    expect(screen.getByText('You have not visited this doctor yet.')).toBeTruthy();
  });
});
