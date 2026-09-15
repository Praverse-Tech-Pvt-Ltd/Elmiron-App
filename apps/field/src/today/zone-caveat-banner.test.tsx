import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
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

// eslint-disable-next-line import/first
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
