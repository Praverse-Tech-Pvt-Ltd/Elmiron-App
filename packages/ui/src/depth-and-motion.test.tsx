import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { tokens } from '@fieldforce/ui-tokens';
import { buttonStyle } from './Button';
import { Card } from './Card';
import { elevationStyle } from './depth';
import { EmptyState } from './EmptyState';
import { FadeIn } from './FadeIn';
import { ReduceMotionContext } from './motion';
import { MAX_SEGMENTS, ProgressSegments } from './ProgressSegments';
import { SkeletonCard, SkeletonRows } from './Skeleton';
import { TabBarIcon } from './TabIcon';
import type { TabIconName } from './TabIcon';
import { BodyText } from './Text';

/**
 * FE-W101 — depth and motion in the shared components.
 *
 * Three things are pinned. **Depth comes from the tokens**: no component carries a shadow literal,
 * and each surface wears the level its kind calls for. **Motion is arrival only and obeys the
 * phone**: under Android's "Remove animations" everything is simply in place, and nothing that
 * animates is a press. **The new pieces keep the old rules**: placeholders and decorative strips
 * are hidden from screen readers, an empty state is never an error, and the tab indicator moves
 * nothing under the thumb.
 */

const flatten = (style: unknown): Record<string, unknown> =>
  StyleSheet.flatten(style) as Record<string, unknown>;

/** The rendered tree's outermost host node. */
const rootProps = (): Record<string, unknown> => {
  const tree = screen.toJSON() as unknown;
  const node = (Array.isArray(tree) ? (tree as unknown[])[0] : tree) as {
    readonly props: Record<string, unknown>;
  } | null;
  return node?.props ?? {};
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('depth comes from the tokens', () => {
  it('draws a level as the design layers, not as one grey elevation', () => {
    expect(elevationStyle('card')['boxShadow']).toEqual(tokens.elevation.card.layers);
    expect(elevationStyle('flat')['boxShadow']).toEqual([]);
  });

  it('rests an ordinary card on the card level and lifts the hero to raised', async () => {
    await render(
      <Card>
        <BodyText>Next visit</BodyText>
      </Card>,
    );
    const plain = flatten(screen.getByText('Next visit').parent?.props['style']);
    expect(plain['boxShadow']).toEqual(tokens.elevation.card.layers);

    await render(
      <Card tone="hero">
        <BodyText>Dr S. Iyer</BodyText>
      </Card>,
    );
    const hero = flatten(screen.getByText('Dr S. Iyer').parent?.props['style']);
    expect(hero['boxShadow']).toEqual(tokens.elevation.raised.layers);
  });

  it('keeps offline and quiet cards flat — waiting, not arriving', async () => {
    for (const tone of ['offline', 'quiet'] as const) {
      await render(
        <Card tone={tone}>
          <BodyText>Saved on this phone</BodyText>
        </Card>,
      );
      const style = flatten(screen.getByText('Saved on this phone').parent?.props['style']);
      expect(style['boxShadow']).toEqual([]);
    }
  });

  it('glows the primary in its accent, the same pressed or not, and drops it when disabled', () => {
    const resting = flatten(buttonStyle('primary', { pressed: false, disabled: false }));
    const pressed = flatten(buttonStyle('primary', { pressed: true, disabled: false }));
    const disabled = flatten(buttonStyle('primary', { pressed: false, disabled: true }));
    expect(resting['boxShadow']).toEqual(tokens.elevation.accent.layers);
    // §05: the press darkens the fill and changes nothing else.
    expect(pressed['boxShadow']).toEqual(resting['boxShadow']);
    expect(disabled['boxShadow']).toEqual([]);
    // Only the primary glows: one primary per screen, so one glow per screen.
    for (const variant of ['secondary', 'quiet', 'destructive'] as const) {
      expect(flatten(buttonStyle(variant, { pressed: false, disabled: false }))['boxShadow']).toBe(
        undefined,
      );
    }
  });

  it('leaves no shadow literal in any component', () => {
    // A shadow colour written into a component is how the warm ink drifts back to black on one
    // screen. Every shadow goes through `elevationStyle`, and the scrim through `tokens.overlay`.
    const offenders = readdirSync(__dirname)
      .filter((name) => /\.tsx?$/u.test(name) && !name.includes('.test.'))
      .filter((name) =>
        /shadowColor|shadowRadius|rgba\(|#14150F/iu.test(
          readFileSync(join(__dirname, name), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});

describe('motion obeys "Remove animations"', () => {
  it('fades content up into place, from a standing start', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await render(
      <FadeIn>
        <BodyText>Arriving</BodyText>
      </FadeIn>,
    );
    const block = screen.getByText('Arriving').parent;
    const style = flatten(block?.props['style']);
    // Mid-entrance in a test renderer: below full opacity, lifted by the rise.
    expect(style['opacity']).toBeLessThan(1);
    expect(block?.props['collapsable']).toBe(false);
  });

  it('is simply there when the phone asks for no animation', async () => {
    await render(
      <ReduceMotionContext.Provider value>
        <FadeIn>
          <BodyText>Nothing planned for today</BodyText>
        </FadeIn>
      </ReduceMotionContext.Provider>,
    );
    const style = flatten(screen.getByText('Nothing planned for today').parent?.props['style']);
    expect(style['opacity']).toBe(1);
    expect(style['transform']).toEqual([{ translateY: 0 }]);
  });

  it('asks the platform once at the root, not once per animated block', async () => {
    const ask = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const blocks = (
      <>
        <FadeIn>
          <BodyText>One</BodyText>
        </FadeIn>
        <FadeIn index={1}>
          <BodyText>Two</BodyText>
        </FadeIn>
      </>
    );

    // Without a provider each block asks for itself...
    await render(blocks);
    expect(ask.mock.calls.length).toBeGreaterThanOrEqual(2);

    // ...and with the root's answer provided, none of them does.
    await render(
      <ReduceMotionContext.Provider value={false}>{blocks}</ReduceMotionContext.Provider>,
    );
    ask.mockClear();
    await render(
      <ReduceMotionContext.Provider value={false}>{blocks}</ReduceMotionContext.Provider>,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it('holds a placeholder still under "Remove animations"', async () => {
    await render(
      <ReduceMotionContext.Provider value>
        <SkeletonCard />
      </ReduceMotionContext.Provider>,
    );
    expect(flatten(rootProps()['style'])['opacity']).toBe(1);
  });

  it('never animates the content wrapper with a scale — §05 keeps presses unmoved', () => {
    // Arrival is a fade and a rise; nothing in the motion module or the animated wrappers drives
    // a scale transform.
    for (const file of [
      'motion.ts',
      'FadeIn.tsx',
      'Skeleton.tsx',
      'Toast.tsx',
      'BottomSheet.tsx',
    ]) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect({ file, scales: /\bscale[XY]?\s*:/u.test(source) }).toEqual({ file, scales: false });
    }
  });
});

describe('placeholders and decoration stay out of the accessibility tree', () => {
  it('hides skeleton cards and rows from screen readers', async () => {
    await render(<SkeletonCard hero />);
    const card = JSON.stringify(screen.toJSON());
    expect(card).toMatch(/^\{"type":"View","props":\{"accessibilityElementsHidden":true/u);
    expect(card).toContain('"importantForAccessibility":"no-hide-descendants"');
    expect(card).not.toContain('"type":"Text"');

    await render(<SkeletonRows count={3} />);
    const rows = JSON.stringify(screen.toJSON());
    expect(rows).toMatch(/^\{"type":"View","props":\{"accessibilityElementsHidden":true/u);
    expect(rows).toContain('"importantForAccessibility":"no-hide-descendants"');
    expect(rows).not.toContain('"type":"Text"');
  });

  it('draws one segment per planned visit and fills the attended ones', async () => {
    await render(<ProgressSegments filled={2} total={5} />);
    const json = JSON.stringify(screen.toJSON());
    expect(json.split(tokens.color.accent).length - 1).toBe(2);
    expect(json.split(tokens.color.washPressed).length - 1).toBe(5);
    expect(json).toContain('"importantForAccessibility":"no-hide-descendants"');
  });

  it('never fills past the plan, and draws nothing for an empty plan', async () => {
    await render(<ProgressSegments filled={7} total={3} />);
    expect(JSON.stringify(screen.toJSON()).split(tokens.color.accent).length - 1).toBe(3);

    await render(<ProgressSegments filled={0} total={0} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('becomes one proportional bar past MAX_SEGMENTS', async () => {
    await render(<ProgressSegments filled={4} total={MAX_SEGMENTS + 8} />);
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain('"flex":4');
    expect(json).toContain(`"flex":${String(MAX_SEGMENTS + 4)}`);
  });
});

describe('EmptyState — a designed state, never an error', () => {
  it('says the caller’s words and keeps its mark out of the accessibility tree', async () => {
    await render(<EmptyState detail="No beat plan came through." title="No route for today" />);
    expect(screen.getByText('No route for today')).toBeTruthy();
    expect(screen.getByText('No beat plan came through.')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain(
      '"importantForAccessibility":"no-hide-descendants"',
    );
  });

  it('carries no warning colour', async () => {
    await render(<EmptyState title="Nothing matches “Iyer”." />);
    const json = JSON.stringify(screen.toJSON());
    expect(json).not.toContain(tokens.color.critical);
    expect(json).not.toContain(tokens.color.attention);
  });
});

describe('TabBarIcon — B1’s active pill', () => {
  const NAMES: readonly TabIconName[] = ['today', 'doctors', 'coaching', 'me'];

  const rootStyle = (): Record<string, unknown> => flatten(rootProps()['style']);

  it.each(NAMES)('%s sits in the success tint when open and on nothing when not', async (name) => {
    await render(<TabBarIcon focused name={name} />);
    const open = rootStyle();
    expect(open['backgroundColor']).toBe(tokens.color.successFill);

    await render(<TabBarIcon focused={false} name={name} />);
    const closed = rootStyle();
    expect(closed['backgroundColor']).toBe('transparent');

    // Same box either way, so switching tab moves nothing under the thumb.
    expect(closed['width']).toBe(open['width']);
    expect(closed['height']).toBe(open['height']);
  });
});
