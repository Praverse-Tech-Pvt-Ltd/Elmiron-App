import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { Banner } from './Banner';
import { Button } from './Button';
import { FILTER_FROM, Select, filterOptions } from './Select';
import { BodyText, Display, Figure, Heading, MAX_FONT_SCALE, Title } from './Text';

/**
 * The round-2 handover polish of the shared primitives (`FE-W189`), asserted on what reaches the
 * screen.
 */
const styleOf = (text: string): Record<string, unknown> =>
  StyleSheet.flatten(screen.getByText(text).props['style']) as Record<string, unknown>;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('FE-W189 — a banner’s detail and action sit in the title’s column', () => {
  it('puts the title, the detail and the action in one column beside the glyph', async () => {
    await render(
      <Banner
        action={{ label: 'Live location', onPress: () => undefined }}
        detail="Your last position did not reach your company."
        title="Your live location is being shared."
        tone="attention"
      />,
    );
    // The column that holds the title's text...
    const column = screen.getByText('Your live location is being shared.').parent?.parent;
    if (column === null || column === undefined) throw new Error('no column above the title');
    // ...also holds the detail and the action: they start where the title starts, not under the
    // glyph at the banner's edge.
    const within = (node: typeof column, text: string): boolean => {
      let at = screen.getByText(text).parent;
      while (at !== null) {
        if (at === node) return true;
        at = at.parent;
      }
      return false;
    };
    expect(within(column, 'Your last position did not reach your company.')).toBe(true);
    expect(within(column, 'Live location')).toBe(true);
  });

  /**
   * `FE-W198`. In the column was not enough: the quiet button's own 24pt side padding still put the
   * LABEL 24pt inside the title's edge, and its 52pt height added a strip under it (screenshot 03b).
   */
  it('FE-W198: the action’s label starts at the title’s edge, with no strip under it', async () => {
    await render(
      <Banner
        action={{ label: 'Live location', onPress: () => undefined }}
        title="Live location is paused outside your working hours."
        tone="info"
      />,
    );
    // The wrapper the banner puts round its button: the nearest ancestor with a margin.
    let wrapper = screen.getByText('Live location').parent;
    const margins = (node: typeof wrapper): Record<string, unknown> =>
      Object.assign(
        {},
        StyleSheet.flatten(node?.props['style'] as Parameters<typeof StyleSheet.flatten>[0]),
      );
    while (wrapper !== null && margins(wrapper)['marginLeft'] === undefined)
      wrapper = wrapper.parent;
    if (wrapper === null) throw new Error('no wrapper round the action');
    // Exactly the button's side padding back: the label lands on the column's edge.
    expect(margins(wrapper)['marginLeft']).toBe(-tokens.space.lg);
    // Its empty lower half stands in for the banner's bottom padding instead of adding to it.
    expect(margins(wrapper)['marginBottom']).toBe(-tokens.space.md);
    // The button itself keeps its tap height.
    expect(screen.getByRole('button', { name: 'Live location' })).toBeTruthy();
  });
});

describe('FE-W189 — a Select looks like a list, not a text field', () => {
  const options = [
    { value: 'sample', label: 'Sample' },
    { value: 'leaflet', label: 'Leaflet' },
  ];

  it('draws a chevron on the control', async () => {
    await render(<Select label="Kind" onChange={() => undefined} options={options} />);
    expect(screen.getByTestId('select-chevron', { includeHiddenElements: true })).toBeTruthy();
  });

  it('marks the chosen option in its sheet with a check, and only that one', async () => {
    await render(
      <Select label="Kind" onChange={() => undefined} options={options} value="leaflet" />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Kind' }));
    expect(
      screen.getAllByTestId('select-chosen-check', { includeHiddenElements: true }),
    ).toHaveLength(1);
    const check = screen.getByTestId('select-chosen-check', { includeHiddenElements: true });
    // The check sits in the chosen row: the row that reads "Leaflet".
    let row = check.parent;
    while (row !== null && row.props['accessibilityState'] === undefined) row = row.parent;
    expect(row?.props['accessibilityState']).toMatchObject({ selected: true });
  });
});

describe('FE-W189 — a button’s reason line is a sentence', () => {
  it('sets the disabled reason at the prose step (Secondary), not the label step', async () => {
    await render(
      <Button
        disabled
        label="Check in"
        note="You are outside the clinic’s geofence."
        onPress={() => undefined}
      />,
    );
    expect(styleOf('You are outside the clinic’s geofence.')['fontSize']).toBe(
      tokens.typography.secondary.size,
    );
  });
});

/**
 * Android 14's non-linear font scaling grew a 27pt title by a few percent at 130% while body grew
 * by 30%. On Android, Title and Heading take the setting linearly. (`@react-native/jest-preset`
 * reports a font scale of 2.)
 */
describe('FE-W189 — titles and headings grow with the font size at least as much as body', () => {
  it('on Android, scales Title and Heading linearly and turns the platform’s scaling off', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    let fontScale = 0;
    const Probe = (): null => {
      fontScale = useWindowDimensions().fontScale;
      return null;
    };
    await render(
      <>
        <Probe />
        <Title>Me</Title>
        <Heading>Dr Asha Deshpande</Heading>
        <BodyText>A sentence.</BodyText>
      </>,
    );
    expect(fontScale).toBeGreaterThan(1);
    expect(styleOf('Me')['fontSize']).toBe(tokens.typography.title.size * fontScale);
    expect(styleOf('Me')['lineHeight']).toBe(tokens.typography.title.lineHeight * fontScale);
    expect(screen.getByText('Me').props['allowFontScaling']).toBe(false);
    expect(styleOf('Dr Asha Deshpande')['fontSize']).toBe(
      tokens.typography.heading.size * fontScale,
    );
    // Body is left to the platform, which scales small text by the full setting.
    expect(styleOf('A sentence.')['fontSize']).toBe(tokens.typography.body.size);
  });

  it('on iOS, leaves Title and Heading to the platform’s own (linear) scaling', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await render(
      <>
        <Title>Me</Title>
        <Heading>Dr Asha Deshpande</Heading>
      </>,
    );
    expect(styleOf('Me')['fontSize']).toBe(tokens.typography.title.size);
    expect(screen.getByText('Me').props['allowFontScaling']).not.toBe(false);
    expect(styleOf('Dr Asha Deshpande')['fontSize']).toBe(tokens.typography.heading.size);
  });

  it('still caps only the figure and the display line', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(
      <>
        <Figure>3 of 8</Figure>
        <Display>Dr Asha Deshpande</Display>
        <Title>Today</Title>
      </>,
    );
    expect(screen.getByText('3 of 8').props['maxFontSizeMultiplier']).toBe(MAX_FONT_SCALE);
    expect(screen.getByText('Dr Asha Deshpande').props['maxFontSizeMultiplier']).toBe(
      MAX_FONT_SCALE,
    );
    expect(screen.getByText('Today').props['maxFontSizeMultiplier']).toBeUndefined();
  });
});

/**
 * `FE-W191`. A long list in a sheet gets a filter field: the unplanned visit's doctor list holds the
 * whole territory, and scrolling it to find one name was the slowest part of starting a visit.
 */
describe('FE-W191 — a long Select list can be filtered', () => {
  const doctors = Array.from({ length: FILTER_FROM }, (_, i) => ({
    value: `d${String(i)}`,
    label: i === 3 ? 'Dr Asha Deshpande' : `Dr Doctor ${String(i)}`,
  }));

  it('narrows the sheet to the names that contain what was typed, ignoring case', async () => {
    await render(
      <Select
        filterLabel="Find a doctor"
        label="Doctor"
        onChange={() => undefined}
        options={doctors}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Doctor' }));
    await fireEvent.changeText(screen.getByLabelText('Find a doctor'), 'asha');
    expect(screen.getByText('Dr Asha Deshpande')).toBeTruthy();
    expect(screen.queryByText('Dr Doctor 1')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Find a doctor'), 'zzz');
    expect(screen.getByText('Nothing on the list matches that.')).toBeTruthy();
  });

  it('shows no filter for a short list', async () => {
    await render(
      <Select
        filterLabel="Find a doctor"
        label="Doctor"
        onChange={() => undefined}
        options={doctors.slice(0, FILTER_FROM - 1)}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Doctor' }));
    expect(screen.queryByLabelText('Find a doctor')).toBeNull();
  });

  it('filters by the label, and an empty query is the whole list', () => {
    expect(filterOptions(doctors, '  ')).toHaveLength(FILTER_FROM);
    expect(filterOptions(doctors, 'DESH').map((option) => option.value)).toEqual(['d3']);
  });
});
