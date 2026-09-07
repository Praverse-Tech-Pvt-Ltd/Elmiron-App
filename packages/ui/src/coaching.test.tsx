import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText } from './Text';
import { BottomSheet } from './BottomSheet';
import { CitationSpan } from './CitationSpan';
import { FindingCard } from './FindingCard';
import { OverrideControl } from './OverrideControl';

const flatten = (style: unknown): Record<string, unknown> =>
  StyleSheet.flatten(style) as Record<string, unknown>;

const CITATION = {
  timestamp: '02:14',
  retention: 'audio kept 61 more days',
  quote: 'it is a lot more than what we are using now, and my patients ask about cost first',
} as const;

/**
 * §05 calls the citation "the atom of contestability", and these tests are about
 * the two ways that promise gets quietly broken: evidence that is not shown, and a
 * redaction that looks like an edit.
 */
describe('a citation shows its evidence and its retention', () => {
  it('renders the timestamp and how long the audio survives, together', async () => {
    await render(<CitationSpan {...CITATION} onPlay={() => undefined} />);
    // One line, because the MR needs both facts before deciding whether to argue
    // with the finding: where it is, and whether it will still be there.
    expect(screen.getByText('02:14 · audio kept 61 more days')).toBeTruthy();
  });

  it('still shows the quote when the audio is gone', async () => {
    // The transcript outliving the audio is a designed state, not a degraded one.
    await render(
      <CitationSpan
        quote={CITATION.quote}
        retention="audio deleted at 90 days · transcript kept"
        timestamp="02:14"
      />,
    );
    expect(screen.getByText('02:14 · audio deleted at 90 days · transcript kept')).toBeTruthy();
    // Nothing to play, so nothing pretends to be playable.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a redaction rather than dropping the sentence', async () => {
    // §05: "it renders [removed] rather than dropping the sentence, so the MR can
    // see something was cut." A silently shortened quote is indistinguishable from
    // a quote that was never said.
    await render(
      <CitationSpan
        quote="the patient [removed] asked about cost first"
        retention="audio kept 61 more days"
        timestamp="02:14"
      />,
    );
    expect(screen.getByText(/\[removed\]/)).toBeTruthy();
  });

  it('plays when pressed', async () => {
    const onPlay = jest.fn();
    await render(<CitationSpan {...CITATION} onPlay={onPlay} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});

describe('a finding always carries its evidence and its terms', () => {
  it('renders the citation inside the card', async () => {
    await render(
      <FindingCard
        citation={CITATION}
        kind="try-this"
        onReply={() => undefined}
        summary="The cost objection at 02:14 was not answered."
      />,
    );
    expect(screen.getByText('The cost objection at 02:14 was not answered.')).toBeTruthy();
    expect(screen.getByText('02:14 · audio kept 61 more days')).toBeTruthy();
  });

  it('tells the MR who sees the reply, and that nothing here is a score', async () => {
    // This is on the card rather than in a help page because it is the difference
    // between coaching and surveillance, and it is only true if the MR knows it.
    await render(
      <FindingCard
        citation={CITATION}
        kind="worked-well"
        onReply={() => undefined}
        summary="You opened with the purpose of the call in eighteen seconds."
      />,
    );
    expect(
      screen.getByText(
        'You are seeing this before your manager acts on it. Your reply goes with it.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Nothing here is a score, and none of it is compared to anyone else.'),
    ).toBeTruthy();
  });

  it('sends the reply the MR wrote', async () => {
    const onReply = jest.fn();
    await render(
      <FindingCard
        citation={CITATION}
        kind="try-this"
        onReply={onReply}
        summary="The cost objection at 02:14 was not answered."
      />,
    );

    await fireEvent.press(screen.getByText('Add your reply'));
    const input = screen.getByLabelText('Your reply — your manager sees this next to the finding');
    await fireEvent.changeText(input, 'He had already seen the pricing sheet.');
    await fireEvent.press(screen.getByText('Send reply'));

    expect(onReply).toHaveBeenCalledWith('He had already seen the pricing sheet.');
  });
});

/**
 * §05 is unusually specific here, and for a reason worth restating: "Agree and
 * Disagree are identical controls in one row, one tap each, no confirm on either.
 * Disagreeing is not an error state and carries no warning colour — it is the
 * evidence of human oversight, so the UI treats it as the ordinary half of an
 * ordinary decision."
 *
 * Every assertion below is a way that could be eroded by a well-meaning change.
 */
describe('overriding an AI finding is an ordinary decision', () => {
  const finding = 'Cost objection at 02:14 not addressed.';

  it('renders the two decisions as the same control at the same size', async () => {
    await render(<OverrideControl finding={finding} onLog={() => undefined} />);
    const agree = flatten(screen.getByText('Agree').parent?.props['style']);
    const disagree = flatten(screen.getByText('Disagree').parent?.props['style']);
    expect(disagree['minHeight']).toBe(agree['minHeight']);
    expect(disagree['backgroundColor']).toBe(agree['backgroundColor']);
  });

  it('gives disagreement no warning colour', async () => {
    await render(<OverrideControl finding={finding} onLog={() => undefined} />);
    const disagree = flatten(screen.getByText('Disagree').parent?.props['style']);
    expect(disagree['backgroundColor']).not.toBe(tokens.color.criticalFill);
    expect(disagree['backgroundColor']).not.toBe(tokens.color.critical);
  });

  it('marks the finding as advisory before either button', async () => {
    await render(<OverrideControl finding={finding} onLog={() => undefined} />);
    expect(screen.getByText('AI finding · advisory · you decide')).toBeTruthy();
  });

  it('takes one tap to decide, then logs the decision with its reason', async () => {
    const onLog = jest.fn();
    await render(<OverrideControl finding={finding} onLog={onLog} />);

    // One tap. No confirmation dialog stands between the two.
    await fireEvent.press(screen.getByText('Disagree'));
    const why = screen.getByLabelText('Why — one line, logged');
    await fireEvent.changeText(why, 'He raised cost again at 04:02 and I answered it there.');
    await fireEvent.press(screen.getByText('Log the override'));

    expect(onLog).toHaveBeenCalledWith(
      'disagree',
      'He raised cost again at 04:02 and I answered it there.',
    );
  });

  it('says who was told once the override is logged', async () => {
    // An override that disappears into a database is not oversight either.
    await render(
      <OverrideControl
        finding={finding}
        onLog={() => undefined}
        outcomeNote="Logged at 14:02. The MR is told you overrode it, and your reason."
      />,
    );
    expect(
      screen.getByText('Logged at 14:02. The MR is told you overrode it, and your reason.'),
    ).toBeTruthy();
    // The decision is made; the buttons are gone rather than sitting there re-armed.
    expect(screen.queryByText('Agree')).toBeNull();
  });
});

describe('the bottom sheet', () => {
  it('renders its rows and its sticky footer while visible', async () => {
    await render(
      <BottomSheet
        footer={<BodyText>Save</BodyText>}
        onDismiss={() => undefined}
        title="Visit outcome"
        visible
      >
        <BodyText>Detailed, samples left</BodyText>
      </BottomSheet>,
    );
    expect(screen.getByText('Visit outcome')).toBeTruthy();
    expect(screen.getByText('Detailed, samples left')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('renders nothing while closed', async () => {
    await render(
      <BottomSheet onDismiss={() => undefined} title="Visit outcome" visible={false}>
        <BodyText>Detailed, samples left</BodyText>
      </BottomSheet>,
    );
    expect(screen.queryByText('Detailed, samples left')).toBeNull();
  });

  it('dismisses when the scrim is pressed', async () => {
    const onDismiss = jest.fn();
    await render(
      <BottomSheet onDismiss={onDismiss} title="Visit outcome" visible>
        <BodyText>Detailed, samples left</BodyText>
      </BottomSheet>,
    );
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
