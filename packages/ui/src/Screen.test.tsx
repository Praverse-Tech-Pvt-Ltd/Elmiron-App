import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Metrics } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText } from './Text';
import { Screen } from './Screen';

/**
 * The safe-area inset, asserted as arithmetic rather than as "a safe-area component
 * is present". A screen can render the right wrapper and still apply nothing.
 *
 * `react-native-safe-area-context/jest/mock` — installed for the whole suite in
 * jest.setup.cjs — returns ZERO insets when no provider is mounted. A test resting
 * on those defaults would assert `md + 0 === md` and pass just as happily with the
 * fix removed. So this file supplies its own metrics, and every expected number is
 * `token + a distinct non-zero inset`. Distinct per edge, so an implementation that
 * wired `insets.top` into all four sides fails here.
 */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 3, right: 7 },
};

const renderInSafeArea = (node: ReactElement): Promise<unknown> =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);

/**
 * The padding actually in force on the rendered content, found by walking up from
 * the text. Which element carries it differs between the two variants — a `View`
 * when the screen does not scroll, the ScrollView's content container when it does
 * — and the assertion is about the number reaching the content either way.
 */
const paddingAroundText = (text: string): Record<string, number> => {
  let node = screen.getByText(text).parent;
  while (node !== null) {
    // Both props, because the two variants put the padding in different places: a
    // plain `View` uses `style`, and a ScrollView keeps `contentContainerStyle` as
    // its own prop rather than flattening it onto a child.
    const candidates = ([] as unknown[]).concat(
      node.props['style'] as unknown[],
      node.props['contentContainerStyle'] as unknown[],
    );
    const merged = Object.assign({}, ...candidates.filter(Boolean)) as Record<string, number>;
    // Resolve the `padding` shorthand into the four edges before asserting. Without
    // this the pre-fix implementation — a plain `padding: space.md` and no inset —
    // fails with "nothing carries a paddingTop", which is true but says nothing
    // about the inset. Resolved, it fails as `16 !== 63`, which is the actual claim.
    const shorthand = merged['padding'];
    if (typeof shorthand === 'number') {
      for (const edge of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']) {
        merged[edge] ??= shorthand;
      }
    }
    if (typeof merged['paddingTop'] === 'number') return merged;
    node = node.parent;
  }
  throw new Error(`no ancestor of "${text}" carries a paddingTop`);
};

describe('Screen safe-area inset', () => {
  it('adds the device inset to the token padding when the screen does not scroll', async () => {
    await renderInSafeArea(
      <Screen>
        <BodyText>fixed content</BodyText>
      </Screen>,
    );

    const padding = paddingAroundText('fixed content');
    expect(padding['paddingTop']).toBe(tokens.space.md + METRICS.insets.top);
    expect(padding['paddingBottom']).toBe(tokens.space.md + METRICS.insets.bottom);
    expect(padding['paddingLeft']).toBe(tokens.space.md + METRICS.insets.left);
    expect(padding['paddingRight']).toBe(tokens.space.md + METRICS.insets.right);
  });

  it('adds it to the content container when the screen scrolls', async () => {
    await renderInSafeArea(
      <Screen scrollable>
        <BodyText>scrolling content</BodyText>
      </Screen>,
    );

    const padding = paddingAroundText('scrolling content');
    // FE-D12 V1: the top inset is no longer inside the scrolling content (next test). What the
    // content container carries at the top is the token margin alone.
    expect(padding['paddingTop']).toBe(tokens.space.md);
    expect(padding['paddingBottom']).toBe(tokens.space.md + METRICS.insets.bottom);
    expect(padding['paddingLeft']).toBe(tokens.space.md + METRICS.insets.left);
    expect(padding['paddingRight']).toBe(tokens.space.md + METRICS.insets.right);
  });

  /**
   * **FE-D12 V1.** With the whole top inset inside the ScrollView's content, it scrolled away
   * with the content, and on the Pixel 10 the clock drew over "May we record this" once the
   * doctor scrolled the consent screen. The status bar's height belongs to a wrapper that does
   * not scroll, so content is clipped below the status bar instead of passing under it. The
   * first paint is unchanged: the content still starts at `inset + md`.
   */
  it('keeps the status-bar inset outside the scrolling content', async () => {
    await renderInSafeArea(
      <Screen scrollable>
        <BodyText>scrolling content</BodyText>
      </Screen>,
    );

    let scroll = screen.getByText('scrolling content').parent;
    while (scroll !== null && scroll.props['contentContainerStyle'] === undefined) {
      scroll = scroll.parent;
    }
    if (scroll === null) throw new Error('no ScrollView above the content');

    let wrapper = scroll.parent;
    let wrapperTop: unknown = undefined;
    while (wrapper !== null && wrapperTop === undefined) {
      const style = Object.assign(
        {},
        ...([] as unknown[]).concat(wrapper.props['style'] as unknown[]).filter(Boolean),
      ) as Record<string, unknown>;
      wrapperTop = style['paddingTop'];
      wrapper = wrapper.parent;
    }
    expect(wrapperTop).toBe(METRICS.insets.top);
  });
});
