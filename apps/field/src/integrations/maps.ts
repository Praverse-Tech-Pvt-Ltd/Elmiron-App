/**
 * Maps — the adapter, and its no-key implementation.
 *
 * **Nothing here needs a Google Maps key.** Directions to a clinic are handed to the phone's own maps
 * app through an intent link (`geo:`), which every Android phone answers with whatever maps app is
 * installed. An embedded map with tiles and routing would need a key (operator question Q-2); this
 * adapter is the seam where that implementation would go, and the screens do not change when it does.
 *
 * Location permission is not involved: opening another app at a place asks for nothing.
 */
export interface MapPlace {
  readonly latitude: number;
  readonly longitude: number;
  /** Shown as the pin's label in the maps app. */
  readonly label: string;
}

export interface MapsAdapter {
  /** A link that opens directions to the place, or null when there is nothing to direct to. */
  readonly directionsLink: (place: MapPlace | null) => string | null;
  /** True when this adapter draws a map itself (needs a key). The no-key adapter never does. */
  readonly embedsMap: boolean;
}

const inRange = (place: MapPlace): boolean =>
  Number.isFinite(place.latitude) &&
  Number.isFinite(place.longitude) &&
  Math.abs(place.latitude) <= 90 &&
  Math.abs(place.longitude) <= 180;

/** The keyless adapter: a `geo:` link the phone's own maps app opens. */
export const noKeyMaps: MapsAdapter = {
  embedsMap: false,
  directionsLink: (place) => {
    if (place === null || !inRange(place)) return null;
    const at = `${String(place.latitude)},${String(place.longitude)}`;
    return `geo:${at}?q=${at}(${encodeURIComponent(place.label)})`;
  },
};
