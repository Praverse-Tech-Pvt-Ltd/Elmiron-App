import type { TeamRep, TrackingTrail } from '@fieldforce/core';

/**
 * `FE-W208` — what the live location map draws, decided here so it is tested without a browser.
 *
 * The map is a picture of the SAME two RPC answers the table below it shows (`live_tracking_overview`
 * and `live_tracking_trail`); it reads nothing else and decides nothing about who may be seen. A rep
 * with no position is simply not a pin — the table still lists them.
 */

/** A position older than this is drawn muted: the phone may have stopped sharing. */
export const STALE_AFTER_SECONDS = 30 * 60;

export interface MapPin {
  readonly mrId: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly stale: boolean;
  /** The pin's caption, e.g. "Asha Rao · 4 min ago". */
  readonly label: string;
  readonly selected: boolean;
}

export interface MapRoute {
  readonly points: readonly (readonly [number, number])[];
}

export const agoLabel = (seconds: number): string => {
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24)
    return rest === 0 ? `${String(hours)} h ago` : `${String(hours)} h ${String(rest)} min ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
};

export const mapPins = (reps: readonly TeamRep[], selectedId: string | null): MapPin[] =>
  reps.flatMap((rep) =>
    rep.latest === null
      ? []
      : [
          {
            mrId: rep.mrId,
            name: rep.fullName,
            latitude: rep.latest.latitude,
            longitude: rep.latest.longitude,
            stale: rep.latest.ageSeconds > STALE_AFTER_SECONDS,
            label: `${rep.fullName} · ${agoLabel(rep.latest.ageSeconds)}`,
            selected: rep.mrId === selectedId,
          },
        ],
  );

/** The chosen rep's day as a line, oldest first — the order the server returns. */
export const mapRoute = (trail: TrackingTrail | null): MapRoute | null =>
  trail === null || trail.points.length === 0
    ? null
    : { points: trail.points.map((point) => [point.latitude, point.longitude] as const) };

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two positions, in kilometres. */
export const haversineKm = (a: readonly [number, number], b: readonly [number, number]): number => {
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * The straight-line distance between the day's kept positions, summed. **Not road distance and not
 * mileage** — the page says so beside it; mileage is the rep's own figure (`daily_mileage`).
 */
export const trailKilometres = (trail: TrackingTrail | null): number | null => {
  const route = mapRoute(trail);
  if (route === null) return null;
  let total = 0;
  for (let i = 1; i < route.points.length; i += 1) {
    const prev = route.points[i - 1];
    const next = route.points[i];
    if (prev !== undefined && next !== undefined) total += haversineKm(prev, next);
  }
  return total;
};

export const kilometresLabel = (km: number): string =>
  km < 10 ? `${km.toFixed(1)} km` : `${String(Math.round(km))} km`;

/** OpenStreetMap by default; a company with heavy use sets its own tile service. */
export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const tileUrl = (configured: string | undefined): string =>
  configured !== undefined && /^https:\/\/.+\{z\}.+\{x\}.+\{y\}/u.test(configured.trim())
    ? configured.trim()
    : DEFAULT_TILE_URL;
