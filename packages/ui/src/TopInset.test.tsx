import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Metrics } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import { BodyText } from './Text';
import { TopInset } from './TopInset';

/**
 * The inset asserted as arithmetic, for the same reason `Screen.test.tsx` does it that way:
 * a component can render the right wrapper and pad it by nothing.
 *
 * The insets are distinct per edge, so an implementation that wired `insets.top` into all
 * four sides fails the third test rather than passing the first by accident. And the
 * zero-inset case is a real positive control — without it, a hard-coded status-bar height
 * would satisfy the first test and be wrong on every device but the one it was measured on.
 */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 3, right: 7 },
};

const NO_INSETS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
};

const renderInSafeArea = (metrics: Metrics, node: ReactElement): Promise<unknown> =>
  render(<SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>);

/** Every contribution to one padding edge between the text and the root, summed. */
const paddingAbove = (text: string, edge: string): number => {
  let node = screen.getByText(text).parent;
  let total = 0;
  while (node !== null) {
    const candidates = ([] as unknown[]).concat(node.props['style'] as unknown[]);
    const merged = Object.assign({}, ...candidates.filter(Boolean)) as Record<string, number>;
    const explicit = merged[edge];
    const shorthand = merged['padding'];
    if (typeof explicit === 'number') total += explicit;
    else if (typeof shorthand === 'number') total += shorthand;
    node = node.parent;
  }
  return total;
};

describe('TopInset', () => {
  it('offsets its children by the device top inset', async () => {
    await renderInSafeArea(
      METRICS,
      <TopInset>
        <BodyText>above the navigator</BodyText>
      </TopInset>,
    );

    expect(paddingAbove('above the navigator', 'paddingTop')).toBe(METRICS.insets.top);
  });

  it('offsets by nothing when the device reports no inset', async () => {
    await renderInSafeArea(
      NO_INSETS,
      <TopInset>
        <BodyText>above the navigator</BodyText>
      </TopInset>,
    );

    expect(paddingAbove('above the navigator', 'paddingTop')).toBe(0);
  });

  it('leaves the other three edges alone', async () => {
    await renderInSafeArea(
      METRICS,
      <TopInset>
        <BodyText>above the navigator</BodyText>
      </TopInset>,
    );

    expect(paddingAbove('above the navigator', 'paddingBottom')).toBe(0);
    expect(paddingAbove('above the navigator', 'paddingLeft')).toBe(0);
    expect(paddingAbove('above the navigator', 'paddingRight')).toBe(0);
  });
});
