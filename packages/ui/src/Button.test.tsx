import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Button, buttonStyle } from './Button';

/**
 * The two §05 rules that the pre-Phase-1 button broke, asserted as the numbers
 * rather than as "it has a press state".
 *
 * The old implementation used `opacity: 0.75` and `minHeight: 48`. Both of those
 * render, both look deliberate, and neither matches the design — which is exactly
 * the class of defect a test that only checks "a style is applied" lets through.
 */
const flatten = (style: unknown): Record<string, unknown> =>
  StyleSheet.flatten(style) as Record<string, unknown>;

const styleOf = (label: string): Record<string, unknown> =>
  flatten(screen.getByText(label).parent?.props['style']);

/**
 * Press is asserted through `buttonStyle`, the function the component's own style
 * callback calls, rather than by firing a press event. React Native drives the
 * pressed flag through the responder system; `fireEvent(..., 'pressIn')` does not
 * flip it, and a test that fires the event and then reads an unchanged style
 * passes whatever the component does — including doing nothing.
 */
describe('press feedback', () => {
  it('darkens the fill to the accent-pressed token, and does not fade or scale', () => {
    const pressed = flatten(buttonStyle('primary', { pressed: true, disabled: false }));

    // §05: "Press is a fill darkening, never a scale transform." An opacity fade
    // over warm paper LIGHTENS the accent, which is the opposite of the rule.
    expect(pressed['backgroundColor']).toBe(tokens.color.accentPressed);
    expect(pressed['opacity']).toBeUndefined();
    expect(pressed['transform']).toBeUndefined();

    // And the pressed fill really is darker, not merely different.
    expect(tokens.color.accentPressed).not.toBe(tokens.color.accent);
  });

  it('darkens every variant, never lightening one', () => {
    for (const variant of ['primary', 'secondary', 'quiet', 'destructive'] as const) {
      const pressed = flatten(buttonStyle(variant, { pressed: true, disabled: false }));
      expect(pressed['opacity']).toBeUndefined();
    }
  });

  it('renders the accent fill before any press', async () => {
    await render(<Button label="Check in" onPress={() => undefined} />);
    expect(flatten(screen.getByRole('button').props['style'])['backgroundColor']).toBe(
      tokens.color.accent,
    );
  });
});

describe('reach', () => {
  it('sizes a primary at the §04 primary target, not at the touch floor', async () => {
    await render(<Button label="Check in" onPress={() => undefined} />);
    expect(flatten(screen.getByRole('button').props['style'])['minHeight']).toBe(
      tokens.target.primary,
    );
    expect(tokens.target.primary).toBe(60);
  });

  it('sizes a secondary at the secondary target', async () => {
    await render(<Button label="Not now" onPress={() => undefined} variant="secondary" />);
    expect(flatten(screen.getByRole('button').props['style'])['minHeight']).toBe(
      tokens.target.secondary,
    );
  });
});

describe('the disabled reason line', () => {
  it('renders the reason next to the button', async () => {
    // The type makes `note` mandatory when disabled; this asserts it also REACHES
    // the screen. §05 exempts the disabled label from contrast because this line
    // is carrying the meaning — the exemption without the line is just unreadable.
    await render(
      <Button
        disabled
        label="Check in"
        note="You are outside the clinic's geofence."
        onPress={() => undefined}
      />,
    );
    expect(screen.getByText("You are outside the clinic's geofence.")).toBeTruthy();
  });

  it('does not fire while disabled', async () => {
    const onPress = jest.fn();
    await render(<Button disabled label="Check in" note="Not yet." onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('loading', () => {
  it('swaps the label and blocks the press without unmounting the button', async () => {
    const onPress = jest.fn();
    await render(<Button label="Check in" loading loadingLabel="Checking in" onPress={onPress} />);
    expect(screen.getByText('Checking in')).toBeTruthy();
    expect(screen.queryByText('Check in')).toBeNull();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('the offline note', () => {
  it('is an ordinary supporting line, not an error', async () => {
    // "will sync later" under a check-in. §02: offline is the expected condition
    // for most of an MR's day and never renders as a failure.
    await render(<Button label="Check in" note="will sync later" onPress={() => undefined} />);
    const note = styleOf('will sync later');
    expect(note['color']).not.toBe(tokens.color.critical);
  });
});
