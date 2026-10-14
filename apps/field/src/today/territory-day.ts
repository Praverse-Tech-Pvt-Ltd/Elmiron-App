import { languageStore, t } from '@fieldforce/ui/i18n';
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

/** Epoch ms of a `YYYY-MM-DD` at UTC midnight -- a day number, never read in local time. */
const dayNumber = (day: string): number => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
};

/**
 * `FE-W199` — how many calendar days, in the territory, lie between an instant and now.
 *
 * "Last seen" counted elapsed 24-hour periods, so a visit completed at 23:38 and read at 02:20 the
 * next morning said "today", and one at 09:00 read at 08:00 two days later said "yesterday". A rep
 * means the DAY: this compares `dayIn` of both instants, as `Date.UTC` day numbers so the device's
 * own zone and its daylight changes play no part.
 */
export const calendarDaysBetween = (
  earlierIso: string,
  nowMs: number,
  zone: TerritoryZone,
): number =>
  Math.round(
    (dayNumber(dayIn(new Date(nowMs).toISOString(), zone)) - dayNumber(dayIn(earlierIso, zone))) /
      (24 * 60 * 60 * 1000),
  );

/**
 * The month names the screens already render.
 *
 * Deliberately NOT `Intl`'s `month: 'short'`: `en-GB` renders September as **"Sept"**, and
 * every existing screen shows "Sep". Changing the visible format while fixing a timezone bug
 * would be two changes wearing one commit, and the second one silent. This table is the same
 * as `MONTHS` in `src/doctors/profile.ts`, which this function replaces for real-data
 * screens; that copy goes when the last mock screen is converted.
 */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * `FE-W149` — a date in the app's language, or null for English (which keeps `MONTHS` above).
 *
 * Hindi and Marathi take their month names from `Intl.DateTimeFormat`, in the territory's zone:
 * React Native 0.86 builds Hermes with `HERMES_ENABLE_INTL`, whose Android half is backed by the
 * platform's ICU (minSdk 24), and Android's ICU carries `hi` and `mr`. `-u-nu-latn` keeps the
 * digits Latin, as every clock time and count on the same screen is (Marathi's default is
 * Devanagari digits). If the runtime does not resolve the locale it asked for, this answers null
 * and the caller prints the English form — a correct date in English rather than a guess.
 */
const INTL_LOCALE = { hi: 'hi-IN-u-nu-latn', mr: 'mr-IN-u-nu-latn' } as const;

export const localisedDayMonth = (instant: Date, timeZone: string): string | null => {
  const language = languageStore.current();
  if (language === 'en') return null;
  const formatter = new Intl.DateTimeFormat(INTL_LOCALE[language], {
    timeZone,
    day: 'numeric',
    month: 'short',
  });
  return formatter.resolvedOptions().locale.startsWith(language) ? formatter.format(instant) : null;
};

/**
 * `FE-W149` — a weekday's name (0 = Sunday) in the app's language, or null for English. Long form,
 * because the one place it is shown says "Mondays and Thursdays" in English; in Hindi and Marathi
 * the weekday's own name reads the same way. Same fallback rule as `localisedDayMonth`.
 */
export const localisedWeekday = (day: number): string | null => {
  const language = languageStore.current();
  if (language === 'en') return null;
  const formatter = new Intl.DateTimeFormat(INTL_LOCALE[language], {
    timeZone: 'UTC',
    weekday: 'long',
  });
  // 4 January 2026 was a Sunday; add `day` to reach the weekday asked for.
  const instant = new Date(Date.UTC(2026, 0, 4 + day));
  return formatter.resolvedOptions().locale.startsWith(language) ? formatter.format(instant) : null;
};

/**
 * `9 Sep` — the calendar date this instant falls on, in that zone, for a human.
 *
 * Replaces `dayMonthFrom` in `src/doctors/profile.ts` for any screen reading real server
 * data. That function slices characters out of the ISO string, on the same premise as
 * `clockFrom`: that the offset in the timestamp is the territory's. The mock at `:4010`
 * sends the territory offset and Supabase sends `Z`, so against Supabase it renders the UTC
 * day — invisible for most of the day and wrong for the rest. A visit received at `19:00Z`
 * is `00:30 IST` the NEXT day and renders as the previous one.
 *
 * MR-24 found the visible half of this on the samples screen, which headed a visit scheduled
 * 11 September as "· 10 Sep" — although that one was the wrong FIELD as well as the wrong
 * zone, `visits.received_at` being when the row arrived rather than when the visit is.
 *
 * Built on the same `partsIn` as `dayIn` and `clockIn`, so all three agree by construction
 * about which day an instant falls on. `en-GB` with `month: 'short'` gives `9 Sep`, matching
 * the format the screens already use.
 */
export const dayMonthIn = (iso: string, zone: TerritoryZone): string => {
  const localised = localisedDayMonth(new Date(iso), zone.timeZone);
  if (localised !== null) return localised;
  const parts = partsIn(iso, zone.timeZone);
  const month = MONTHS[Number(parts['month'] ?? '0') - 1];
  const day = Number(parts['day'] ?? '0');
  return month === undefined ? dayIn(iso, zone) : `${String(day)} ${month}`;
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
/**
 * W2-C A3 — "6 Oct" from a calendar DATE (`YYYY-MM-DD`) the server already reckoned in the
 * territory, such as `visit.visitDay`. A date has no time and no offset, so there is nothing to
 * convert; anything that is not exactly a date gives `null` rather than a guess.
 */
export const dayMonthOfDate = (date: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) return null;
  // `FE-W149`. A calendar date, so it is read in UTC: nothing to convert, only to name.
  const localised = localisedDayMonth(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
    'UTC',
  );
  if (localised !== null) return localised;
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? null : `${String(Number(match[3]))} ${month}`;
};

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

/**
 * **`FE-W45`, second half — MR-36 C2. The zone's discriminant, read at the call site.**
 *
 * `UTC_FALLBACK` is a valid `TerritoryZone`. It is *labelled* — `source: 'fallback_utc'` —
 * so the absence has always been representable. That was never the problem. The problem was
 * that **eleven screens read the zone's VALUE and none read its discriminant**: every date
 * and clock they render is computed in it, and for a territory in IST a fallback is 5h30m
 * out, which moves a late-evening visit onto the previous calendar day.
 *
 * MR-33 fixed the ORDERING — records and zone now arrive together, so there is no render
 * holding real visits against a fallback that is about to be corrected. It did not make the
 * fallback VISIBLE when it is the final answer, and that is the half this closes.
 *
 * Returns the sentence to show, or `null` when the zone is the territory's own. A string
 * rather than a boolean so the caller cannot render a warning without its reason.
 */
export const zoneCaveat = (zone: TerritoryZone): string | null =>
  zone.source === 'territory' ? null : t('day.zoneCaveat');
