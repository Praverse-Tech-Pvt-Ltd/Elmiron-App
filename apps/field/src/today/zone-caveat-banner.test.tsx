import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Metrics } from 'react-native-safe-area-context';
import { tokens } from '@fieldforce/ui-tokens';
import type { TerritoryZone } from './territory-day';

/**
 * `FE-W45`, second half — MR-36 C2. The WIRING, not the decision.
 *
 * `territory-day.test.ts` asserts `zoneCaveat` itself and mutates it. This is the other half:
 * that the banner actually asks, and actually renders the answer. A correct decision function
 * behind an inverted `if` is the same defect with a passing unit test beside it.
 *
 * **`render` MUST be awaited here.** A bare `render(...)` returns before `screen` is
 * populated, and every query then fails with "`render` function has not been called" — which
 * reads like the render never happened rather than like a missing `await`. Every
 * `src/routes/*.test.tsx` in this repo awaits it for this reason. See `docs/gotchas.md`.
 *
 * `../sync/pulled-store` is mocked because importing it reaches `../supabase` and then
 * `../config`, whose `loadAppConfig` throws at module load without an `.env` — the same reason
 * every `src/routes/*.test.tsx` mocks it.
 */
const mockZone = jest.fn<() => TerritoryZone>();
jest.mock('../sync/pulled-store', () => ({ usePulledStore: () => ({ zone: mockZone() }) }));

import { ZoneCaveatBanner } from './ZoneCaveatBanner';

describe('ZoneCaveatBanner', () => {
  it('renders nothing when the zone is the territory’s own', async () => {
    mockZone.mockReturnValue({ timeZone: 'Asia/Kolkata', source: 'territory' });

    await render(<ZoneCaveatBanner />);

    expect(screen.queryByText(/Times may be wrong/u)).toBeNull();
  });

  it('warns, and says how far out the dates may be, on the UTC fallback', async () => {
    mockZone.mockReturnValue({ timeZone: 'UTC', source: 'fallback_utc' });

    await render(<ZoneCaveatBanner />);

    expect(screen.getByText(/Times may be wrong/u)).toBeTruthy();
    // Assert the content, not the container: a banner that warns without naming the
    // consequence is one an MR learns to swipe past.
    expect(screen.getByText(/5 hours 30 minutes/u)).toBeTruthy();
  });

  it('does not warn a territory whose timezone genuinely IS UTC', async () => {
    // The positive control for the discriminant. If the banner ever keys on the timezone
    // NAME rather than on `source`, this is the test that fails.
    mockZone.mockReturnValue({ timeZone: 'UTC', source: 'territory' });

    await render(<ZoneCaveatBanner />);

    expect(screen.queryByText(/Times may be wrong/u)).toBeNull();
  });
});

/**
 * The safe-area inset, which this component has to apply itself because
 * `app/_layout.tsx` mounts it ABOVE `<Stack>` — outside `packages/ui/Screen`, the one
 * place every other component gets the inset from. Without it the banner renders under
 * the status bar and the clock overlaps its title, which is what a Pixel 10 (API 36)
 * showed.
 *
 * Asserted as **arithmetic on the distance that actually reaches the title**, not as
 * "a wrapper is present" — a component can render the right wrapper and pad it by
 * nothing. The insets are distinct per edge so an implementation that wired the top
 * inset into all four sides fails the horizontal check below.
 *
 * `react-native-safe-area-context/jest/mock` — installed suite-wide in `jest.setup.cjs`
 * — returns ZERO insets when no provider is mounted, so the three tests above are
 * unaffected by this one, and the zero-inset case here is a real positive control
 * rather than a second copy of the same assertion.
 */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 3, right: 7 },
};

const NO_INSETS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
};

const renderWithMetrics = (metrics: Metrics): Promise<unknown> =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ZoneCaveatBanner />
    </SafeAreaProvider>,
  );

/**
 * Every contribution to one padding edge between the title text and the root, summed.
 *
 * Summed rather than "the first ancestor that carries one", because the padding is
 * deliberately split across two elements: `Banner` keeps its own token padding and this
 * component adds the device inset above it. Stopping at the first match would read
 * `Banner`'s token and report the inset as missing whether it was applied or not.
 *
 * The `padding` shorthand is resolved into the edge it covers — `Banner` uses the
 * shorthand, and an unresolved one would be counted as zero.
 */
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

describe('ZoneCaveatBanner safe-area inset', () => {
  it('clears the status bar by the device inset, on top of the banner’s own padding', async () => {
    mockZone.mockReturnValue({ timeZone: 'UTC', source: 'fallback_utc' });

    await renderWithMetrics(METRICS);

    expect(paddingAbove('Times may be wrong', 'paddingTop')).toBe(
      tokens.space.md + METRICS.insets.top,
    );
  });

  it('adds nothing when the device reports no inset — the number comes from the device', async () => {
    // The positive control. Without it, an implementation that hard-coded a status-bar
    // height would pass the test above and be wrong on every device but one.
    mockZone.mockReturnValue({ timeZone: 'UTC', source: 'fallback_utc' });

    await renderWithMetrics(NO_INSETS);

    expect(paddingAbove('Times may be wrong', 'paddingTop')).toBe(tokens.space.md);
  });

  it('does not pad the sides, which a portrait-locked app has no inset for', async () => {
    // Distinctness control: `insets.left` is 3 and `insets.right` is 7, so an
    // implementation that applied the inset to every edge fails here rather than
    // passing the vertical assertion by accident.
    mockZone.mockReturnValue({ timeZone: 'UTC', source: 'fallback_utc' });

    await renderWithMetrics(METRICS);

    expect(paddingAbove('Times may be wrong', 'paddingLeft')).toBe(tokens.space.md);
    expect(paddingAbove('Times may be wrong', 'paddingRight')).toBe(tokens.space.md);
  });
});
