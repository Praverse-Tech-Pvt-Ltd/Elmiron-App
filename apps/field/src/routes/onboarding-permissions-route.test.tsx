import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { NOTIFICATION_TYPES, capSentence } from '../onboarding/notifications';

/**
 * The fill and height actually in force on the control carrying `label`, found by
 * walking up from the text to the first ancestor that sets a background. Comparing
 * these between two actions is how "de-emphasises neither" becomes checkable rather
 * than a comment.
 */
const flatten = (style: unknown): Record<string, unknown> => {
  // Merged by hand rather than with `StyleSheet.flatten`: the repo's ESLint rule
  // bars react-native's primitives from apps/field entirely, and a test is not an
  // exemption from the rule that keeps components in @fieldforce/ui.
  if (Array.isArray(style))
    return Object.assign({}, ...style.map(flatten)) as Record<string, unknown>;
  if (typeof style === 'object' && style !== null) return style as Record<string, unknown>;
  return {};
};

const fillAndHeightOf = (label: string): { backgroundColor: unknown; minHeight: unknown } => {
  let node = screen.getByText(label).parent;
  while (node !== null) {
    const style = flatten(node.props['style']);
    if (style['backgroundColor'] !== undefined) {
      return { backgroundColor: style['backgroundColor'], minHeight: style['minHeight'] };
    }
    node = node.parent;
  }
  throw new Error(`no ancestor of "${label}" sets a backgroundColor`);
};

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));

import LocationDenied from '../../app/onboarding/location-denied';
import MicrophoneRationale from '../../app/onboarding/microphone';
import NotificationsRationale from '../../app/onboarding/notifications';

describe('A3 — notifications name what they are and cap the count', () => {
  it('names all four types rather than promising to "stay updated"', async () => {
    await render(<NotificationsRationale />);
    for (const type of NOTIFICATION_TYPES) {
      expect(screen.getByText(type.name)).toBeTruthy();
    }
  });

  it('states the cap on the same screen as the names', async () => {
    // Names without a cap is a request for consent to an unbounded thing: four
    // categories, any number of messages.
    await render(<NotificationsRationale />);
    expect(screen.getByText(capSentence())).toBeTruthy();
  });

  it('does not use vague reassurance in place of the names', async () => {
    await render(<NotificationsRationale />);
    expect(screen.queryByText(/stay updated/iu)).toBeNull();
    expect(screen.queryByText(/important updates/iu)).toBeNull();
  });

  it('offers declining as an ordinary choice, not a warning', async () => {
    await render(<NotificationsRationale />);
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it('weights allowing and declining identically', async () => {
    // "'Not now' is not a lesser choice rendered as one" is the screen's own claim,
    // and it is only true if the two controls are the same size and the same fill.
    // Neither takes the primary accent: §04 gives a screen one primary action and a
    // permission ask has no single answer the app is entitled to push.
    await render(<NotificationsRationale />);
    expect(fillAndHeightOf('Allow notifications')).toEqual(fillAndHeightOf('Not now'));
    expect(fillAndHeightOf('Allow notifications').backgroundColor).not.toBe(tokens.color.accent);
  });
});

describe('A4 — the microphone, and the separation that must not collapse', () => {
  it("keeps the MR's own note and recording a consultation as separate statements", async () => {
    // THE DESIGN DECISION THIS TEST EXISTS TO PROTECT.
    //
    // Conflating these into one friendly sentence about "recording" is how the app
    // earns a surveillance reputation on day one — and it would be untrue: a note the
    // MR dictates has no third party in it, and a consultation recording needs the
    // doctor to agree every time. Asserted as two distinct rendered nodes, so a
    // rewrite that merges them into one paragraph fails here.
    await render(<MicrophoneRationale />);

    const ownNote = screen.getByText(/Your note is yours/u);
    const consultation = screen.getByText(/needs the doctor to agree/u);
    expect(ownNote).toBeTruthy();
    expect(consultation).toBeTruthy();
    expect(ownNote).not.toBe(consultation);
  });

  it('says the note records only while the button is held', async () => {
    await render(<MicrophoneRationale />);
    expect(screen.getByText(/only while you hold the button/u)).toBeTruthy();
  });

  it('says consent is needed every time, not once', async () => {
    await render(<MicrophoneRationale />);
    expect(screen.getByText(/every time/u)).toBeTruthy();
  });

  it('labels the consultation block so the two are visually separate too', async () => {
    await render(<MicrophoneRationale />);
    expect(screen.getByText('Recording a consultation is separate')).toBeTruthy();
  });

  it('weights allowing and declining identically', async () => {
    // Consent to a microphone is not an outcome this screen steers towards, so
    // neither control is dressed as the expected answer. Same assertion as its two
    // sibling screens, because the claim is the same on all three.
    await render(<MicrophoneRationale />);
    expect(fillAndHeightOf('Allow the microphone')).toEqual(fillAndHeightOf('Not now'));
    expect(fillAndHeightOf('Allow the microphone').backgroundColor).not.toBe(tokens.color.accent);
  });
});

describe('S4 — location denied', () => {
  it("uses the design's own words about what the MR loses", async () => {
    await render(<LocationDenied />);
    expect(screen.getByText(/Check-ins need a tap each/u)).toBeTruthy();
    expect(screen.getByText(/14\s*\n?\s*minutes a day/u)).toBeTruthy();
    expect(screen.getByText(/₹600 a month/u)).toBeTruthy();
  });

  it('labels the 14 minutes and ₹600 as estimates rather than measurements', async () => {
    // Nothing in this repository measured either number. Presenting an estimate as a
    // measurement to the person whose own day it describes is how the rest of the
    // screen loses its credibility too.
    await render(<LocationDenied />);
    expect(screen.getByText(/Estimates from the product design, not measured/u)).toBeTruthy();
  });

  it('gives two actions and de-emphasises neither', async () => {
    // "Two equal actions" is a claim about the markup, not only the copy. Both are
    // the same Button variant and both are enabled; rendering "Carry on by hand" as
    // a quieter control would be the app arguing with a decision it just said it
    // accepted.
    await render(<LocationDenied />);

    const turnOn = screen.getByText('Turn location back on');
    const carryOn = screen.getByText('Carry on by hand');
    expect(turnOn).toBeTruthy();
    expect(carryOn).toBeTruthy();

    // Queried through the role filter rather than by reading `props`, which is
    // untyped: this asks the accessibility tree the same question a screen reader
    // would, and neither action may answer "disabled".
    expect(screen.getAllByRole('button').length).toBe(2);
    expect(screen.queryAllByRole('button', { disabled: true })).toEqual([]);

    // And equal in the pixels, not only in the count. The previous version of this
    // test would have passed just as happily with one action promoted to the filled
    // accent — "two buttons, neither disabled" is true of a coercive screen too.
    expect(fillAndHeightOf('Turn location back on')).toEqual(fillAndHeightOf('Carry on by hand'));
  });

  it('does not give either action the primary accent fill', async () => {
    // §04 gives a screen ONE primary action. Two accent fills read as two competing
    // primaries; §05 resolves a genuine either/or the way OverrideControl does, with
    // two identical secondary controls. Asserted against the token rather than a hex
    // literal, so a palette change cannot silently satisfy it.
    await render(<LocationDenied />);
    expect(fillAndHeightOf('Turn location back on').backgroundColor).not.toBe(tokens.color.accent);
    expect(fillAndHeightOf('Carry on by hand').backgroundColor).not.toBe(tokens.color.accent);
  });

  it('does not dress a normal state as a failure', async () => {
    // No critical banner, no alert role. Location denied is a choice the MR made, and
    // `BannerTone` reserves `critical` for genuine failures.
    await render(<LocationDenied />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
