import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, Platform, ScrollView, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Metrics } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import { tokens } from '@fieldforce/ui-tokens';
import { BodyText } from './Text';
import { FOLLOW_SLACK, REVEAL_BELOW, Screen, isAtBottom, revealOffset } from './Screen';

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

  /**
   * UX polish: the footer is PINNED -- outside the ScrollView, so the primary action is never
   * scrolled to -- and it, not the content, sits on the gesture bar.
   */
  it('pins the footer outside the scrolling content and gives it the bottom inset', async () => {
    await renderInSafeArea(
      <Screen scrollable footer={<BodyText>the action</BodyText>}>
        <BodyText>scrolling content</BodyText>
      </Screen>,
    );

    let node = screen.getByText('the action').parent;
    while (node !== null) {
      expect(node.props['contentContainerStyle']).toBeUndefined();
      const style = Object.assign(
        {},
        ...([] as unknown[]).concat(node.props['style'] as unknown[]).filter(Boolean),
      ) as Record<string, unknown>;
      if (style['paddingBottom'] !== undefined) {
        expect(style['paddingBottom']).toBe(tokens.space.md + METRICS.insets.bottom);
        break;
      }
      node = node.parent;
    }
    expect(node).not.toBeNull();
    expect(paddingAroundText('scrolling content')['paddingBottom']).toBe(tokens.space.md);
  });
});

describe('Screen followLatest — a conversation follows its newest message, not a reader', () => {
  const at = (y: number) => ({
    contentOffset: { x: 0, y },
    contentSize: { width: 390, height: 2000 },
    layoutMeasurement: { width: 390, height: 800 },
  });

  it('at the bottom, or within the slack, it follows', () => {
    expect(isAtBottom(at(1200))).toBe(true);
    expect(isAtBottom(at(1200 - FOLLOW_SLACK))).toBe(true);
  });

  it('scrolled up to read history, it does not', () => {
    expect(isAtBottom(at(1200 - FOLLOW_SLACK - 1))).toBe(false);
    expect(isAtBottom(at(0))).toBe(false);
  });

  it('is wired only when asked for', async () => {
    await renderInSafeArea(
      <Screen followLatest scrollable>
        <BodyText>a conversation</BodyText>
      </Screen>,
    );
    let node = screen.getByText('a conversation').parent;
    while (node !== null && node.props['onContentSizeChange'] === undefined) node = node.parent;
    expect(node).not.toBeNull();
  });
});

/**
 * `FE-W187`. The pinned footer rides up with the keyboard. Under Android's edge-to-edge layout the
 * window is no longer resized for the keyboard, and the keyboard was drawn over "Sign in", "Send
 * report" and "Save". The keyboard is driven here through the listeners `Screen` and its
 * `KeyboardAvoidingView` register, with the frame the view measures — no native keyboard exists
 * in a test.
 */
describe.each(['android', 'ios'] as const)(
  'Screen footer and the keyboard on %s (FE-W187)',
  (os) => {
    type Handler = (event: unknown) => void;
    const listeners: { event: string; handler: Handler }[] = [];

    const emit = async (kind: 'Show' | 'Hide', keyboardHeight: number): Promise<void> => {
      const event = {
        duration: 0,
        easing: 'keyboard',
        startCoordinates: { screenX: 0, screenY: 844, width: 390, height: 0 },
        endCoordinates: {
          screenX: 0,
          screenY: 844 - keyboardHeight,
          width: 390,
          height: keyboardHeight,
        },
      };
      await act(async () => {
        // Both platforms' names: iOS announces "will", Android "did". Whichever the test platform
        // registered is the one that runs.
        for (const { event: name, handler } of listeners) {
          if (name === `keyboardWill${kind}` || name === `keyboardDid${kind}`) handler(event);
        }
        await Promise.resolve();
      });
    };

    const styleOf = (node: { props: Record<string, unknown> }): Record<string, unknown> =>
      Object.assign(
        {},
        ...([] as unknown[])
          .concat(node.props['style'] as unknown[])
          .flat(3)
          .filter(Boolean),
      ) as Record<string, unknown>;

    /** The footer's own padded view: the nearest ancestor of the action with a bottom padding. */
    const footerPadding = (): unknown => {
      let node = screen.getByText('Send report').parent;
      while (node !== null) {
        const bottom = styleOf(node)['paddingBottom'];
        if (bottom !== undefined) return bottom;
        node = node.parent;
      }
      return undefined;
    };

    /** The KeyboardAvoidingView: the ancestor that measures its own frame. */
    const avoider = () => {
      let node = screen.getByText('Send report').parent;
      while (node !== null && node.props['onLayout'] === undefined) node = node.parent;
      if (node === null) throw new Error('no view above the footer measures its frame');
      return node;
    };

    const renderForm = async (): Promise<void> => {
      await renderInSafeArea(
        <Screen scrollable footer={<BodyText>Send report</BodyText>}>
          <BodyText>a long form</BodyText>
        </Screen>,
      );
    };

    beforeEach(() => {
      // The defect was Android's: before the fix this view had no behaviour there at all.
      jest.replaceProperty(Platform, 'OS', os);
      listeners.length = 0;
      jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, handler: Handler) => {
        listeners.push({ event, handler });
        return { remove: () => undefined };
      }) as unknown as typeof Keyboard.addListener);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('lifts the screen by the keyboard where the window is not resized (edge-to-edge)', async () => {
      await renderForm();
      // The whole window: edge-to-edge, the keyboard is drawn over the bottom of this frame.
      await fireEvent(avoider(), 'layout', {
        persist: () => undefined,
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
      });
      expect(styleOf(avoider())['paddingBottom'] ?? 0).toBe(0);

      await emit('Show', 300);
      expect(styleOf(avoider())['paddingBottom']).toBe(300);
      // The keyboard covers the gesture bar: the footer keeps its margin, not the bar's inset too.
      expect(footerPadding()).toBe(tokens.space.md);

      await emit('Hide', 0);
      expect(styleOf(avoider())['paddingBottom'] ?? 0).toBe(0);
      expect(footerPadding()).toBe(tokens.space.md + METRICS.insets.bottom);
    });

    /**
     * `FE-W198`. Android scrolled only the cursor into view, before the screen shrank: the footer
     * covered the password field's lower edge and its "Show password" (screenshot 02b).
     */
    it('FE-W198: scrolls the focused field, and the control under it, above the footer', async () => {
      const scrollTo = jest.fn();
      jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(scrollTo);
      // Not in the hand-written types, though the component has it (the jest mock's prototype too).
      jest
        .spyOn(
          ScrollView.prototype as unknown as { getInnerViewRef: () => unknown },
          'getInnerViewRef',
        )
        .mockReturnValue({});
      jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockReturnValue({
        measureLayout: (_to: unknown, ok: (x: number, y: number, w: number, h: number) => void) => {
          ok(16, 420, 358, 56);
        },
      } as unknown as ReturnType<typeof TextInput.State.currentlyFocusedInput>);
      await renderForm();
      // The scroll view after the shrink: 400 tall, ending at the footer's top edge.
      let scroll = screen.getByText('a long form').parent;
      while (scroll !== null && scroll.props['onScroll'] === undefined) scroll = scroll.parent;
      if (scroll === null) throw new Error('no scroll view');
      await emit('Show', 300);
      await fireEvent(scroll, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 400 } },
      });

      expect(scrollTo).toHaveBeenCalledWith({ y: 420 + 56 + REVEAL_BELOW - 400, animated: true });
    });

    it('adds nothing where the system already shrank the window to the keyboard', async () => {
      await renderForm();
      // The frame ends where the keyboard begins: a window resized by `adjustResize`.
      await fireEvent(avoider(), 'layout', {
        persist: () => undefined,
        nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 544 } },
      });
      await emit('Show', 300);
      expect(styleOf(avoider())['paddingBottom'] ?? 0).toBe(0);
    });
  },
);

/**
 * `FE-W188`. With `headerShown: false` no screen had a way back on screen. `onBack` draws one: a
 * labelled control at least the tap floor, at the top, that does what the app passes.
 */
describe('Screen back control (FE-W188)', () => {
  it('draws a labelled Back control that calls onBack', async () => {
    const onBack = jest.fn();
    await renderInSafeArea(
      <Screen onBack={onBack} scrollable>
        <BodyText>a pushed screen</BodyText>
      </Screen>,
    );
    const back = screen.getByRole('button', { name: 'Back' });
    await fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    const style = Object.assign(
      {},
      ...([] as unknown[])
        .concat(
          typeof back.props['style'] === 'function'
            ? (back.props['style'] as (s: { pressed: boolean }) => unknown)({ pressed: false })
            : back.props['style'],
        )
        .flat(3)
        .filter(Boolean),
    ) as Record<string, number>;
    expect(style['minHeight']).toBeGreaterThanOrEqual(tokens.target.floor);
  });

  it('keeps the status bar inset above the control, outside the content', async () => {
    await renderInSafeArea(
      <Screen onBack={() => undefined}>
        <BodyText>fixed content</BodyText>
      </Screen>,
    );
    // The content no longer carries the status bar's height: the wrapper above the control does.
    expect(paddingAroundText('fixed content')['paddingTop']).toBe(tokens.space.xs);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('draws nothing when the screen has no onBack (a tab, sign-in, first run)', async () => {
    await renderInSafeArea(
      <Screen>
        <BodyText>a tab</BodyText>
      </Screen>,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('Screen back control on a doctor-facing screen (FE-W188, FE-W148)', () => {
  it('draws the word it is given instead of the catalogue’s', async () => {
    await renderInSafeArea(
      <Screen backLabel="Return" onBack={() => undefined}>
        <BodyText>the notice in full</BodyText>
      </Screen>,
    );
    // A word the catalogue does not hold, so the assertion fails if the catalogue's is drawn.
    expect(screen.getByRole('button', { name: 'Return' })).toBeTruthy();
    expect(screen.queryByText('Back')).toBeNull();
  });
});

describe('revealOffset — a focused field and what is under it, above the footer (FE-W198)', () => {
  it('already in view: nothing to do', () => {
    expect(revealOffset({ fieldTop: 100, fieldHeight: 56, offset: 0, viewport: 400 })).toBeNull();
  });

  it('below the fold: scrolls just far enough for the field and the control under it', () => {
    expect(revealOffset({ fieldTop: 420, fieldHeight: 56, offset: 0, viewport: 400 })).toBe(
      420 + 56 + REVEAL_BELOW - 400,
    );
  });

  it('counts how far the content is already scrolled', () => {
    expect(revealOffset({ fieldTop: 420, fieldHeight: 56, offset: 200, viewport: 400 })).toBeNull();
  });

  it('on a viewport too short for both, keeps the field’s own top in view', () => {
    expect(revealOffset({ fieldTop: 500, fieldHeight: 120, offset: 0, viewport: 100 })).toBe(
      500 - tokens.space.md,
    );
  });
});
