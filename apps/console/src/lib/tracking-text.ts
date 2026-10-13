/**
 * `FE-W72` / `BE-W180` — what the live-tracking page says, in the manager's and the admin's words.
 *
 * **Every rule is the database's** (`20261013000100_live_tracking`): who may see which rep, whether
 * the company switch is on, which positions were kept. This file only names times, ages and
 * refusals. Pure, and outside the `'use client'` files, so it is tested without a renderer.
 */
export interface Refusal {
  readonly code?: string | null;
  readonly message: string;
}

/**
 * `HH:MM` in the rep's own zone. The server sends instants in UTC; a manager in another city reads
 * the rep's clock, which is the one the rep's working hours are set in.
 */
export const clockIn = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/** How old a position is, from the server's own count of seconds. Never computed from this machine. */
export const ageLabel = (seconds: number): string => {
  if (seconds < 60) return 'under a minute ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ${String(minutes % 60)} min ago`;
  return `${String(Math.floor(hours / 24))} day(s) ago`;
};

export const accuracyLabel = (metres: number | null): string =>
  metres === null ? 'accuracy not reported' : `within about ${String(Math.round(metres))} m`;

export const trackingRefusal = ({ code, message }: Refusal): string => {
  if (/only a manager or an admin/u.test(message)) {
    return 'Only a field manager or an admin sees reps’ locations.';
  }
  if (/not permitted to see that rep/u.test(message)) {
    return 'That rep is not in your territory or reporting line, so their locations are not shown.';
  }
  if (/only an admin switches live tracking/u.test(message)) {
    return 'Only an admin switches live location on or off for the company. Nothing was changed.';
  }
  if (/live_tracking_switch_needs_reason/u.test(message)) {
    return 'Say why — the reason is kept with the change. Nothing was changed.';
  }
  if (code === '28000') return 'Your session has ended. Sign in again.';
  return `The server refused this: ${message}`;
};

/**
 * `FE-W87` — the Google Maps Embed URL for one position, or null when no embed key is configured.
 *
 * `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` is a browser key (Maps Embed API only, restricted by HTTP
 * referrer to the console's domain), so it is public by design -- it is in the page either way. Unset,
 * there is no map and the page is exactly as before: the "Open in Google Maps" links need no key.
 * Only the coordinates go to Google; never a name.
 */
export const embedMapUrl = (
  key: string | undefined,
  latitude: number,
  longitude: number,
): string | null => {
  const trimmed = (key ?? '').trim();
  if (trimmed === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const q = `${String(latitude)},${String(longitude)}`;
  return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(trimmed)}&q=${encodeURIComponent(q)}&zoom=15`;
};
