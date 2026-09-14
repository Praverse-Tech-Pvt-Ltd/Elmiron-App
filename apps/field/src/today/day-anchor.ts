import { dayIn } from './territory-day';
import type { DayZoneSource, TerritoryZone } from './territory-day';

/**
 * `FE-W40` option D — what an MR may be shown on a cold start with no signal.
 *
 * **The problem.** `today` is derived from the pull's `serverTime` and was not persisted, so a
 * RESTART with no signal left `summariseDay` with no day to summarise and Today rendered
 * *"Could not load your day"* over a store holding every visit. The visits were there. The
 * DATE was not. That is `MR-15 A2` working, not failing — the territory's day comes from the
 * SERVER's clock and never the handset's — and it is also useless exactly when it is opened,
 * which an 8-hour `FE-G2` run meets on its first morning.
 *
 * **What this does.** Persist the last server instant WITH the device instant it arrived at,
 * and on a cold start render the day it implies **only while that anchor still falls on the
 * same territory day**. Past that, render nothing and say why — option **A**'s behaviour,
 * which is the honest one.
 *
 * **Why option D and not C.** C shows the anchored day with its age and no bound. Its failure
 * is the common case, not an exotic one: last sync 18:20, app opened 07:40 next morning, and
 * the MR is shown YESTERDAY'S list — correctly labelled and still the wrong list. "Yesterday's
 * visits, labelled yesterday" is a subtler wrong than an error message because it is
 * actionable and actionably wrong. The bound is what makes C safe.
 *
 * **Why not option B.** Falling back to `new Date()` is `MR-15 A2`'s defect behind a
 * condition. It is named and refused in `docs/decisions/FE-W40-cold-start-staleness.md`, and
 * since MR-29 A3 it is a lint failure as well as a decision.
 *
 * **The device-clock dependence, stated rather than discovered.** Deciding whether the stored
 * day is still today requires knowing how much time has passed, and only the handset can say.
 * That is unavoidable for every option except A, and it is the ELAPSED-duration case the
 * MR-29 A3 rule allows: the handset measures a DURATION between two of its own readings; it
 * never supplies the instant. The instant is always the server's. A phone whose clock jumped
 * forward renders `expired` and shows nothing, which is the safe direction.
 */
export interface DayAnchor {
  /** The `serverTime` of the pull that produced it. The SERVER's instant, never the device's. */
  readonly serverTime: string;
  /**
   * The device's own clock at the moment that pull returned, used ONLY as the start of an
   * elapsed measurement. It is never rendered and never treated as an instant.
   */
  readonly receivedAt: number;
  /**
   * **The zone is persisted WITH the anchor, and this is not incidental.**
   *
   * The zone comes from the server too (`fetchTerritoryZone`), so a cold start with no signal
   * cannot re-fetch it. Computing the boundary against `UTC_FALLBACK` would reckon the day in
   * a different zone than the one it was decided in — for IST that is a 5h30m error, which is
   * the MR-14 defect in a new place. Carrying it means the boundary is computed in the same
   * zone the anchor was created in, and that the restored day and the clocks beside it agree.
   */
  readonly timeZone: string;
  readonly zoneSource: DayZoneSource;
}

/**
 * The verdict on an anchor.
 *
 * `expired` still carries its `day` and `asOf` so the screen can say WHY it is showing
 * nothing — "your last sync was yesterday" — rather than repeating the generic failure. A
 * reason the MR can act on is the difference between this and option A alone.
 */
export type AnchoredDay =
  | { readonly kind: 'current'; readonly day: string; readonly asOf: string }
  | { readonly kind: 'expired'; readonly day: string; readonly asOf: string };

/** The zone the anchor was taken in, in the shape `territory-day.ts` takes. */
export const anchorZone = (anchor: DayAnchor): TerritoryZone => ({
  timeZone: anchor.timeZone,
  source: anchor.zoneSource,
});

/**
 * Is the anchored day still the territory's today?
 *
 * `deviceNow` is passed in rather than read here, so the caller owns the one device-clock read
 * and this stays a pure function a test can drive across a boundary.
 *
 * Returns `null` for an anchor whose `serverTime` does not parse — a value that crossed a
 * process boundary and a build that may not be this one. A day computed from `NaN` would be
 * `"Invalid Date"` rendered as a date, which is the parse-do-not-cast rule that
 * `pulled-store-persistence.ts` already applies to the records.
 */
export const resolveAnchoredDay = (anchor: DayAnchor, deviceNow: number): AnchoredDay | null => {
  const anchoredMs = Date.parse(anchor.serverTime);
  if (Number.isNaN(anchoredMs)) return null;

  const zone = anchorZone(anchor);
  const day = dayIn(anchor.serverTime, zone);

  /**
   * **Clamped at zero, deliberately.**
   *
   * A device whose clock moved BACKWARDS since the anchor was written would otherwise project
   * the server instant into the past, and an anchor from yesterday evening could be dragged
   * back across the boundary and read as `current`. Clamping makes a backwards clock look like
   * no time passing, which can only ever hold a `current` anchor current — never resurrect an
   * expired one.
   */
  const elapsedMs = Math.max(0, deviceNow - anchor.receivedAt);
  const projected = new Date(anchoredMs + elapsedMs).toISOString();

  return {
    kind: day === dayIn(projected, zone) ? 'current' : 'expired',
    day,
    asOf: anchor.serverTime,
  };
};
