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
