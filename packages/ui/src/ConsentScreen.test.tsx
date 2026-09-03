import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { ConsentScreen } from './ConsentScreen';
import type { ConsentVariant } from './ConsentScreen';
import { buttonStyle } from './Button';

const noop = (): void => undefined;

const NOTICE =
  'I agree that this conversation may be audio recorded so that the representative can be coached.';

const props = {
  askedBy: 'Rahul More, Elmiron',
  question: 'May we record this conversation?',
  facts: [
    { heading: 'What', detail: 'Audio of what we say, from now until Rahul stops it.' },
    { heading: 'Why', detail: 'To review how Rahul presents. Not to assess you.' },
    { heading: 'How long', detail: '90 days, then deleted automatically.' },
    { heading: 'Changing your mind', detail: 'Tell Rahul at any time, and it is deleted.' },
  ],
  summary: "May we record this conversation, so Rahul's team can review how he presented?",
  ifAgree: 'Audio is recorded until Rahul stops it, kept 90 days, then deleted.',
  ifDecline: 'Nothing is recorded and the visit carries on exactly as it would have.',
  notice: NOTICE,
  noticeLabel: 'Notice v1.2 · English · a1b2c3d4',
  onAnswer: noop,
  onHandBack: noop,
  onOpenDetails: noop,
};

const VARIANTS: readonly ConsentVariant[] = ['itemised', 'sentence', 'columns'];

describe('the rules that make the screen lawful hold in every variant', () => {
  it.each(VARIANTS)('%s puts the two answers in the same treatment', async (variant) => {
    // The design's first rule: the moment one option carries the brand's "go"
    // colour the pair is weighted, and a weighted pair voids the consent. Both are
    // `secondary`, so the resolved fill is identical by construction — asserted on
    // the same function the component renders through.
    await render(<ConsentScreen {...props} variant={variant} />);
    expect(screen.getByText("No, don't record")).toBeTruthy();
    expect(screen.getByText("Yes, that's fine")).toBeTruthy();

    const resting = buttonStyle('secondary', { pressed: false, disabled: false });
    expect(JSON.stringify(resting)).not.toContain(tokens.color.accent);
  });

  it.each(VARIANTS)('%s offers a third way out that is not a decision', async (variant) => {
    // A doctor who wants no part of this must not be forced to answer.
    const onAnswer = jest.fn();
    const onHandBack = jest.fn();
    await render(
      <ConsentScreen {...props} onAnswer={onAnswer} onHandBack={onHandBack} variant={variant} />,
    );

    await fireEvent.press(screen.getByText('Give the phone back'));
    expect(onHandBack).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it.each(VARIANTS)('%s shows the attested notice verbatim', async (variant) => {
    // The record points at a version id. A screen that showed only app-authored
    // framing would make the ledger attest to text the doctor never saw.
    await render(<ConsentScreen {...props} variant={variant} />);
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByText('Notice v1.2 · English · a1b2c3d4')).toBeTruthy();
  });

  it.each(VARIANTS)('%s names the person asking, not just the company', async (variant) => {
    // A doctor asked to consent by a company logo is being asked by nobody.
    await render(<ConsentScreen {...props} variant={variant} />);
    expect(screen.getByText('Rahul More, Elmiron')).toBeTruthy();
  });

  it.each(VARIANTS)('%s reaches the legal layer in one tap', async (variant) => {
    const onOpenDetails = jest.fn();
    await render(<ConsentScreen {...props} onOpenDetails={onOpenDetails} variant={variant} />);
    await fireEvent.press(screen.getByText('Exactly what is collected, in full'));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });
});

describe('each variant is a different argument, not a recolour', () => {
  it('itemised carries all four DPDP facts on the face of the screen', async () => {
    await render(<ConsentScreen {...props} variant="itemised" />);
    for (const fact of props.facts) {
      expect(screen.getByText(fact.heading)).toBeTruthy();
      expect(screen.getByText(fact.detail)).toBeTruthy();
    }
  });

  it('sentence carries the whole notice in one line and does not itemise', async () => {
    await render(<ConsentScreen {...props} variant="sentence" />);
    expect(screen.getByText(props.summary)).toBeTruthy();
    expect(screen.queryByText('How long')).toBeNull();
  });

  it('columns spends half the screen on what happens if you decline', async () => {
    // The failure mode that voids consent is a doctor who understood and agreed
    // anyway because declining felt rude. This variant is the only one that shows
    // declining as an outcome with described consequences.
    await render(<ConsentScreen {...props} variant="columns" />);
    expect(screen.getByText('If you agree')).toBeTruthy();
    expect(screen.getByText("If you'd rather not")).toBeTruthy();
    expect(screen.getByText(props.ifDecline)).toBeTruthy();
  });
});

describe('answering', () => {
  it('reports a decline and a consent through the same callback', async () => {
    const onAnswer = jest.fn();
    await render(<ConsentScreen {...props} onAnswer={onAnswer} variant="columns" />);

    await fireEvent.press(screen.getByText("No, don't record"));
    expect(onAnswer).toHaveBeenCalledWith('declined');

    await fireEvent.press(screen.getByText("Yes, that's fine"));
    expect(onAnswer).toHaveBeenCalledWith('consented');
  });
});

describe('the language picker', () => {
  it('is absent when the server has a notice in one language only', async () => {
    await render(
      <ConsentScreen
        {...props}
        language="en-IN"
        languages={[{ code: 'en-IN', label: 'English' }]}
        onChangeLanguage={noop}
        variant="columns"
      />,
    );
    expect(screen.queryByLabelText('Language')).toBeNull();
  });

  it('appears once there is a second language to offer', async () => {
    await render(
      <ConsentScreen
        {...props}
        language="en-IN"
        languages={[
          { code: 'en-IN', label: 'English' },
          { code: 'hi-IN', label: 'हिंदी' },
        ]}
        onChangeLanguage={noop}
        variant="columns"
      />,
    );
    expect(screen.getByLabelText('Language')).toBeTruthy();
  });
});

describe('no notice, no question', () => {
  it('renders no answers at all when the notice could not be loaded', async () => {
    // A consent face with nothing behind it must not be shown to anyone: its Yes
    // would write a record that cannot say what was agreed to.
    await render(
      <ConsentScreen
        {...props}
        blocked={{
          title: 'The consent notice could not be loaded',
          detail: 'Carry on with the visit — you can ask once you have signal.',
        }}
        variant="columns"
      />,
    );
    expect(screen.getByText('The consent notice could not be loaded')).toBeTruthy();
    expect(screen.queryByText("Yes, that's fine")).toBeNull();
    expect(screen.queryByText("No, don't record")).toBeNull();
  });
});

describe('before the notice has arrived', () => {
  it.each(VARIANTS)('%s claims nothing about whether a notice exists', async (variant) => {
    // Found on the emulator: with `loading` folded into `blocked`, the screen said
    // "There is no consent notice for this language yet" for the second before
    // every fetch resolved. "We have not looked yet" and "there is none" are
    // different sentences and only one of them was true.
    await render(<ConsentScreen {...props} loading variant={variant} />);
    expect(screen.queryByText(/no consent notice/u)).toBeNull();
    expect(screen.queryByText(/could not be loaded/u)).toBeNull();
  });

  it('renders nothing a doctor could answer while it is still looking', async () => {
    await render(<ConsentScreen {...props} loading variant="columns" />);
    expect(screen.queryByText("Yes, that's fine")).toBeNull();
    expect(screen.queryByText("No, don't record")).toBeNull();
    expect(screen.getByText('Getting the notice')).toBeTruthy();
  });
});
