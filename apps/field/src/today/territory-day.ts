/**
 * Which day is it, and what time does that timestamp say — MR-15 A2.
 *
 * **The defect this exists to fix.** Every screen in this app read clock times by slicing
 * characters out of the ISO string, justified by a comment in `plan.ts` that says: *"The
 * contract sends an offset (`2026-08-10T10:04:00+05:30`), and that offset is the
 * territory's, not the handset's. Slicing keeps the time the server meant."*
 *
 * That is true of `services/mock`, which every screen was built and tested against — its
 * fixtures are all `+05:30`. **It is false of Supabase**, which renders `+00:00`:
 *
 * ```
 * mock          2026-07-01T00:00:00+05:30
 * sync_pull     2026-09-10T07:30:00+00:00      <- the same wall-clock convention it is not
 * ```
 *
 * So a visit at `07:30+00:00` — 13:00 in Asia/Kolkata — was displayed to the MR as
 * **"Scheduled 07:30"**. Measured, not inferred: `Intl.DateTimeFormat` on the device
 * returned `10/09/2026, 13:00` for exactly that input. Every clock reading taken from real
 * server data was five and a half hours early, and the MR-14 B3 screenshots show it.
 *
 * ---
 *
 * **THE DAY BOUNDARY, STATED.** The reviewer asked which one this is. It is:
 *
 *   > **The TERRITORY's day**, in the timezone the server resolves for that territory,
 *   > from an instant the SERVER stamped. Neither the device clock nor the device
 *   > timezone takes part in the decision.
 *
 * Three inputs, all the server's:
 *
 *   1. `territory_shift_windows.timezone` — reached through `my_shift_window()`, which
 *      calls `resolve_shift_window()` and therefore inherits territory -> org default.
 *      This is the same authority that already decides the shift window, which is a
 *      compliance judgement; "which day was this visit on" is the same kind of question
 *      and must not be answered by a different clock.
 *   2. `serverTime` from the `sync_pull` response — what "now" is.
 *   3. The instant in the row itself, which is unambiguous because the ISO carries an
 *      offset. `new Date(iso)` is exact here; it is the FORMATTING that must not use the
 *      device's zone, not the parsing.
 *
 * A UTC day would cut the MR's day at **05:30 IST**, which is inside a working morning —
 * an early check-in, a day-end run after midnight, and a visit logged at 05:00 all land on
 * the wrong side. The device's day is no better: it is whatever the handset is set to, and
 * a phone on the wrong timezone would silently move every visit.
 *
 * **When the server will not say.** `my_shift_window()` returns a null window for an MR
 * with no territory, or a territory with no configured hours — and shift hours are not
 * configured in production (`docs/blocked-on-you.md`). There is no honest way to invent a
 * timezone, so this falls back to **UTC and says so**: `TerritoryDay.source` is
 * `'fallback_utc'` rather than `'territory'`. UTC is the frame the server itself renders
 * in, so it is the server's answer rather than the client's guess — but it is the wrong
 * day boundary for an Indian field rep, and a caller that cares must be able to tell.
 */

/** Where the timezone came from. A caller must be able to tell an answer from a fallback. */
export type DayZoneSource = 'territory' | 'fallback_utc';

export interface TerritoryZone {
  /** IANA name, e.g. `Asia/Kolkata`. */
  readonly timeZone: string;
  readonly source: DayZoneSource;
}

export const UTC_FALLBACK: TerritoryZone = { timeZone: 'UTC', source: 'fallback_utc' };

/**
 * The parts of an instant, as they read in a given zone.
 *
 * `formatToParts` rather than `format`, because the formatted string's shape is a locale's
 * business and this needs specific fields. `en-GB` is passed only to keep the parts
 * numeric; nothing here renders the locale's own ordering.
 *
 * **Not wrapped in try/catch.** An invalid IANA name is a programming error or a corrupt
 * server response, and both should be loud. The one place a bad zone can legitimately
 * arrive — the server declining to answer — is handled by `UTC_FALLBACK` at the source,
 * not by swallowing an exception here.
 */
const partsIn = (iso: string, timeZone: string): Record<string, string> => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
};

/**
 * `2026-09-10` — the calendar date this instant falls on, in that zone.
 *
 * This is what "which day" means everywhere in this app. Comparing two of these compares
 * days as the territory experiences them.
 */
export const dayIn = (iso: string, zone: TerritoryZone): string => {
  const parts = partsIn(iso, zone.timeZone);
  return `${parts['year'] ?? ''}-${parts['month'] ?? ''}-${parts['day'] ?? ''}`;
};

/**
 * `13:00` — the wall-clock time this instant reads in that zone.
 *
 * Replaces `clockFrom`'s character slice for any screen reading real server data. Hermes
 * on this build supports `Intl` with a `timeZone`; verified on the device rather than
 * assumed, because a silent fallback to the device zone here would reintroduce exactly the
 * defect this file exists to remove.
 *
 * `hour12: false` gives `13:00` rather than `1:00 pm`, matching the 24-hour convention the
 * screens already use.
 *
 * **There is deliberately no `24:00` -> `00:00` normalisation here.** The first draft had
 * one, on the well-known `hour12: false` quirk where some ICU versions render midnight as
 * hour 24. Measured on both runtimes that matter rather than assumed: Node's ICU and
 * Hermes on the device both return `00:00` for IST midnight, and removing the branch left
 * all eleven cases passing. A guard no runtime reaches, carrying a comment that says it is
 * needed, is the defect this repository already has fourteen instances of. If a future
 * runtime does render `24`, `renders midnight as 00:00 and never as 24:00` fails and says
 * so.
 */
export const clockIn = (iso: string, zone: TerritoryZone): string => {
  const parts = partsIn(iso, zone.timeZone);
  return `${parts['hour'] ?? '00'}:${parts['minute'] ?? '00'}`;
};

/**
 * Today, as the territory reckons it — from the SERVER's clock.
 *
 * `serverTime` comes off the `sync_pull` response. It is deliberately a required argument
 * rather than a `new Date()` default: a default would let a caller silently fall back to
 * the handset, which is the failure this whole module is about, and it would do so without
 * anybody having to write the word `Date`.
 */
export const territoryToday = (serverTime: string, zone: TerritoryZone): string =>
  dayIn(serverTime, zone);
