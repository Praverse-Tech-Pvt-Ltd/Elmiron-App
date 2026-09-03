import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Card } from './Card';
import { IconButton } from './IconButton';
import { TextField } from './TextField';
import { BodyText } from './Text';

/**
 * The three Phase 1 primitives that had no test of their own.
 *
 * All three were exercised indirectly — `Card` and `TextField` through most of the
 * screen suites — so they were never untested, only unpinned: no test named the
 * rule each one exists to enforce, and a change that broke the rule while keeping
 * the screens rendering would have gone through green.
 */

const noop = (): void => undefined;

describe('IconButton — §05: a glyph never appears without words', () => {
  it('takes its accessible name from the required label, not the glyph', async () => {
    // `label` is required rather than optional the way `accessibilityLabel`
    // usually is. A glyph alone is ambiguous to a screen reader, to a new MR, and
    // to the same MR in a hurry.
    await render(<IconButton glyph="⚙" label="Settings" onPress={noop} />);
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('fires once when pressed', async () => {
    const onPress = jest.fn();
    await render(<IconButton glyph="⚙" label="Settings" onPress={onPress} />);
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['disabled', { disabled: true }],
    ['loading', { loading: true }],
  ])('does not fire while %s', async (_name, over) => {
    const onPress = jest.fn();
    await render(<IconButton glyph="⚙" label="Settings" onPress={onPress} {...over} />);
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is a state when active, not a different control', async () => {
    // Active fills with the accent rather than changing shape or size, so a
    // toggled control stays the same target in the same place.
    await render(<IconButton active glyph="⚙" label="Settings" onPress={noop} />);
    const active = JSON.stringify(screen.toJSON());
    expect(active).toContain(tokens.color.accent);
    expect(active).toContain(`"width":${String(tokens.target.secondary)}`);

    await render(<IconButton glyph="⚙" label="Settings" onPress={noop} />);
    const resting = JSON.stringify(screen.toJSON());
    expect(resting).not.toContain(tokens.color.accent);
    // Same square either way — the fill changed, the target did not.
    expect(resting).toContain(`"width":${String(tokens.target.secondary)}`);
  });
});

describe('TextField — §05: the label is a sibling, never a placeholder', () => {
  it('keeps the label visible once the field has a value', async () => {
    // A placeholder disappears the moment the field is filled, and a form filled
    // in a corridor becomes a column of numbers with nothing saying which is the
    // odometer.
    await render(<TextField label="Odometer reading" onChangeText={noop} value="41208" />);
    expect(screen.getByText('Odometer reading')).toBeTruthy();
    expect(screen.getByDisplayValue('41208')).toBeTruthy();
  });

  it('carries the correction in the error, not just the failure', async () => {
    // §05's own worked example. A message that says a value is wrong without
    // saying what right looks like sends the MR back to a paper log.
    await render(
      <TextField
        error="Needs 5 digits — yesterday you ended at 41,208"
        label="Odometer reading"
        onChangeText={noop}
        value="41,2"
      />,
    );
    expect(screen.getByText('Needs 5 digits — yesterday you ended at 41,208')).toBeTruthy();
  });

  it('shows help only while there is no error to show instead', async () => {
    await render(
      <TextField help="Set by your manager" label="Territory" onChangeText={noop} value="" />,
    );
    expect(screen.getByText('Set by your manager')).toBeTruthy();

    await render(
      <TextField
        error="Pick a territory"
        help="Set by your manager"
        label="Territory"
        onChangeText={noop}
        value=""
      />,
    );
    expect(screen.getByText('Pick a territory')).toBeTruthy();
    expect(screen.queryByText('Set by your manager')).toBeNull();
  });

  it('offers no clear affordance until there is something to clear', async () => {
    const onClear = jest.fn();
    await render(<TextField label="Search" onChangeText={noop} onClear={onClear} value="" />);
    expect(screen.queryByLabelText('Clear Search')).toBeNull();

    await render(<TextField label="Search" onChangeText={noop} onClear={onClear} value="Iyer" />);
    await fireEvent.press(screen.getByLabelText('Clear Search'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('reports the value through the label a screen reader will read', async () => {
    await render(<TextField label="Doctor name" onChangeText={noop} value="Dr A. Menon" />);
    expect(screen.getByLabelText('Doctor name')).toBeTruthy();
  });
});

describe('Card — §05: separation by surface, one hero, dashed for offline', () => {
  it('is not pressable without an onPress, so a display card cannot be tapped', async () => {
    // A card without `onPress` renders as a View: nothing announces a button role
    // that would do nothing.
    await render(
      <Card>
        <BodyText>Next visit</BodyText>
      </Card>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Next visit')).toBeTruthy();
  });

  it('becomes a button when it is given something to do', async () => {
    const onPress = jest.fn();
    await render(
      <Card onPress={onPress}>
        <BodyText>Next visit</BodyText>
      </Card>,
    );
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('turns text white inside the hero without the caller passing a colour', async () => {
    // The point of `SurfaceContext`: the failure mode of forgetting is ink on ink,
    // which is invisible rather than merely wrong.
    await render(
      <Card tone="hero">
        <BodyText>Dr S. Iyer</BodyText>
      </Card>,
    );
    expect(JSON.stringify(screen.toJSON())).toContain(tokens.color.onAccent);
  });

  it('marks offline with a dashed edge, so the state never rests on colour', async () => {
    // §02: offline is a normal working state and carries no warning colour, so the
    // dash is the signal and it has to survive a palette change.
    await render(
      <Card tone="offline">
        <BodyText>Saved on this phone</BodyText>
      </Card>,
    );
    const offline = JSON.stringify(screen.toJSON());
    expect(offline).toContain('"borderStyle":"dashed"');
    expect(offline).toContain(tokens.color.offlineEdge);
    // Not raised: a saved-here card is waiting, not arriving.
    expect(offline).toContain('"shadowOpacity":0');
    // And never a warning colour.
    expect(offline).not.toContain(tokens.color.critical);
    expect(offline).not.toContain(tokens.color.attention);
  });

  it('draws no dashed edge on an ordinary card', async () => {
    await render(
      <Card>
        <BodyText>Next visit</BodyText>
      </Card>,
    );
    expect(JSON.stringify(screen.toJSON())).not.toContain('"borderStyle":"dashed"');
  });
});
