import { describe, expect, it, vi } from 'vitest';
import { fetchTerritoryZone } from './shift-window';

/**
 * MR-15 A2 — the zone, and whether the app admits it does not know one.
 *
 * **Written because a mutation escaped.** Changing the error path to return
 * `{ timeZone: 'UTC', source: 'territory' }` — a fallback wearing the label of an answer —
 * passed all 47 cases in `src/today`. `source` was decorative, which is the same shape as
 * a guard with no positive control.
 *
 * It has to be load-bearing: `fallback_utc` means the day boundary is UTC, which cuts an
 * Indian working day at 05:30 local, and a caller that cannot tell an answer from a
 * fallback cannot tell the MR either.
 */

const rpc = (impl: () => { data: unknown; error: { message: string } | null }) => ({
  rpc: vi.fn(() => Promise.resolve(impl())),
});

const WINDOW = {
  source: 'territory',
  window: {
    shiftStart: '04:00:00',
    shiftEnd: '23:59:00',
    timezone: 'Asia/Kolkata',
    graceMinutes: 30,
    activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  },
  resolvedFromTerritoryId: '5a736aec-65ad-4cb0-80be-bc566de007be',
};

describe('the zone comes from the server, or is admitted to be a fallback', () => {
  it("reads the territory's timezone out of my_shift_window", async () => {
    // The positive control. Without it, "always return the fallback" would pass every
    // case below while making the app permanently wrong about the day.
    const client = rpc(() => ({ data: WINDOW, error: null }));
    expect(await fetchTerritoryZone(client)).toEqual({
      timeZone: 'Asia/Kolkata',
      source: 'territory',
    });
  });

  it('calls the RPC that already decides the shift window, not a second source', async () => {
    // `resolve_shift_window()` inherits territory -> org default, and it is the authority
    // that already makes a compliance judgement about this MR's working day. A separate
    // query against `territory_shift_windows` would read one row and lose the inheritance.
    const client = rpc(() => ({ data: WINDOW, error: null }));
    await fetchTerritoryZone(client);
    expect(client.rpc).toHaveBeenCalledWith('my_shift_window', {});
  });

  it('LABELS the fallback when the server refuses', async () => {
    // The mutation that escaped: returning UTC with `source: 'territory'` is a fallback
    // wearing the label of an answer.
    const client = rpc(() => ({ data: null, error: { message: 'nope' } }));
    const zone = await fetchTerritoryZone(client);
    expect(zone.source).toBe('fallback_utc');
    expect(zone.timeZone).toBe('UTC');
  });

  it('LABELS the fallback when the MR has no configured window', async () => {
    // Not an error path. `my_shift_window()` returns a null window for an MR with no
    // territory, or a territory whose hours nobody has set -- and shift hours are NOT
    // configured in production, so this is the EXPECTED path there.
    const client = rpc(() => ({ data: { window: null, source: null }, error: null }));
    expect((await fetchTerritoryZone(client)).source).toBe('fallback_utc');
  });

  it('LABELS the fallback when the timezone is not a usable string', async () => {
    // A non-string reaching `Intl.DateTimeFormat` throws RangeError, which would turn
    // "the server did not say" into a crashed screen.
    const client = rpc(() => ({ data: { window: { timezone: 42 } }, error: null }));
    expect((await fetchTerritoryZone(client)).source).toBe('fallback_utc');
  });

  it('LABELS the fallback when the timezone is blank', async () => {
    const client = rpc(() => ({ data: { window: { timezone: '   ' } }, error: null }));
    expect((await fetchTerritoryZone(client)).source).toBe('fallback_utc');
  });

  it('does not throw when the call itself blows up', async () => {
    // A day still has to render. This is the deliberate asymmetry with the pull: a pull
    // that fails means the screens are stale and the MR must be told; a zone that cannot
    // be fetched means the boundary is UTC and labelled.
    const client = { rpc: vi.fn(() => Promise.reject(new Error('network'))) };
    expect((await fetchTerritoryZone(client as never)).source).toBe('fallback_utc');
  });
});
