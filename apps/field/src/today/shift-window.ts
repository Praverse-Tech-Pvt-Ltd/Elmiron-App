import { resolveClient } from '../capture/client';
import type { RpcCaller } from '../capture/client';
import { UTC_FALLBACK } from './territory-day';
import type { TerritoryZone } from './territory-day';

/**
 * The territory's timezone, from the server — MR-15 A2.
 *
 * **`my_shift_window()` has had an endpoint path in `packages/core` since the contract was
 * written and no caller anywhere.** It is the function that already decides the shift
 * window, which is a compliance judgement, and it resolves through
 * `resolve_shift_window()` — so it inherits territory -> org default rather than reading
 * one row. That makes it the right authority for "which day is this", and the wrong thing
 * to duplicate.
 *
 * Only the timezone is read here. The shift bounds belong to capture, which enforces them
 * server-side in `record_check_in`; a client that also held them would be a second copy of
 * a rule the database owns, which this repo does not do.
 */

/**
 * Ask the server what zone this MR's day is reckoned in.
 *
 * **Never throws, and that is a deliberate asymmetry with the pull.** A pull that fails
 * means the screens are stale and the MR must be told. A shift window that cannot be
 * reached means the app does not know the territory's zone — which is a real answer with a
 * real consequence, but the day still has to render. So this degrades to
 * `UTC_FALLBACK`, which is *labelled*, rather than refusing.
 *
 * The response shape is `{ window: { timezone, ... } | null, source, ... }`. A null window
 * is not an error: it is an MR with no territory, or a territory whose hours nobody has
 * configured — and shift hours are NOT configured in production
 * (`docs/blocked-on-you.md`), so this is the expected path there, not the exceptional one.
 */
export const fetchTerritoryZone = async (client?: RpcCaller): Promise<TerritoryZone> => {
  try {
    const db = await resolveClient<RpcCaller>(client);
    const { data, error } = await db.rpc('my_shift_window', {});
    if (error !== null) return UTC_FALLBACK;

    const timeZone = readTimeZone(data);
    return timeZone === null ? UTC_FALLBACK : { timeZone, source: 'territory' };
  } catch {
    return UTC_FALLBACK;
  }
};

/**
 * The timezone out of the response, or null.
 *
 * Read defensively rather than parsed with a schema, because the only field this needs is
 * one string and a schema for the rest would assert a shape this module does not use. A
 * non-string is treated as absent: passing a bad value to `Intl.DateTimeFormat` throws a
 * `RangeError`, and that would turn "the server did not say" into a crashed screen.
 */
const readTimeZone = (data: unknown): string | null => {
  if (typeof data !== 'object' || data === null) return null;
  const window = (data as { window?: unknown }).window;
  if (typeof window !== 'object' || window === null) return null;
  const timeZone = (window as { timezone?: unknown }).timezone;
  return typeof timeZone === 'string' && timeZone.trim() !== '' ? timeZone : null;
};
