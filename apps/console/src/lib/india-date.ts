/**
 * Today's date in India, as `YYYY-MM-DD` (`FE-W125`).
 *
 * The console's day pickers defaulted to `new Date().toISOString().slice(0, 10)` — the UTC date. A
 * server runs in UTC, so from midnight to 05:30 IST every manager opening `/days` or `/planning` was
 * shown YESTERDAY's day, with nothing on the page saying so. Every territory this product serves is
 * in India, so the default is India's date; a rep's own day is still reckoned in their territory's
 * zone by the database, and an explicit `?date=` still wins.
 */
export function indiaToday(now: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * `FE-W166` — every date a person reads, in one shape: "14 Oct 2026", and "14 Oct 2026, 09:15" where
 * the time matters. The console printed `2026-10-14`, `2026-10-14T03:45:00+00:00` and a UTC clock
 * side by side; a manager in Pune had to do the arithmetic.
 *
 * **The month names are this file's, not the runtime's.** `Intl` in Node and in a browser can
 * disagree (`en-GB` gives "Sept" in newer ICU data), and a client component rendered on the server
 * and then hydrated must produce the same characters on both sides. So `Intl` is asked only for
 * NUMBERS in India's zone, and the words are spelled here.
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

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

const named = (year: string, month: string, day: string): string | null => {
  const word = MONTHS[Number(month) - 1];
  return word === undefined ? null : `${String(Number(day))} ${word} ${year}`;
};

/**
 * A calendar day (`2026-10-14`) as "14 Oct 2026". A day has no zone, so nothing is converted; a
 * value that is not a day is returned as it came rather than hidden.
 */
export const dayLabel = (day: string): string => {
  const m = DAY.exec(day);
  if (m === null) return day;
  return named(m[1] ?? '', m[2] ?? '', m[3] ?? '') ?? day;
};

interface IndiaParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
}

const indiaParts = (iso: string): IndiaParts | null => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
};

/** An instant as its date in India: "14 Oct 2026". An unreadable value is shown as it came. */
export const indiaDate = (iso: string): string => {
  const p = indiaParts(iso);
  return p === null ? iso : (named(p.year, p.month, p.day) ?? iso);
};

/** An instant as its date and clock time in India: "14 Oct 2026, 09:15". */
export const indiaDateTime = (iso: string): string => {
  const p = indiaParts(iso);
  if (p === null) return iso;
  const date = named(p.year, p.month, p.day);
  return date === null ? iso : `${date}, ${p.hour}:${p.minute}`;
};
