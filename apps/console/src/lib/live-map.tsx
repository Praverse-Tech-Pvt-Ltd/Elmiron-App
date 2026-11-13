'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Map as LeafletMap } from 'leaflet';
import type { MapPin, MapRoute } from './live-map-data';
import { tileUrl, tooltipHtml } from './live-map-data';

/**
 * `FE-W208` — every rep's newest position, and the chosen rep's day as a line, on a real map with no
 * API key. Leaflet over OpenStreetMap tiles (or `NEXT_PUBLIC_MAP_TILE_URL`). Loaded in the browser
 * only: Leaflet touches `window` on import.
 *
 * Pins are circles, not Leaflet's image markers (their icon paths break under a bundler). A pin is
 * a link to the same `/tracking?rep=` the table uses, so the map chooses nothing the table could not.
 */
const COLOR = { pin: '#35593A', selected: '#B5562B', stale: '#8A8F87', route: '#B5562B' } as const;

export const LiveMap = ({
  pins,
  route,
}: {
  readonly pins: readonly MapPin[];
  readonly route: MapRoute | null;
}): ReactNode => {
  const holder = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const element = holder.current;
    if (element === null || pins.length === 0) return undefined;
    let map: LeafletMap | null = null;
    let cancelled = false;
    void import('leaflet').then((leaflet) => {
      if (cancelled) return;
      const L = leaflet.default;
      map = L.map(element, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(tileUrl(process.env['NEXT_PUBLIC_MAP_TILE_URL']), {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const bounds = L.latLngBounds([]);
      if (route !== null && route.points.length > 0) {
        const line = L.polyline(
          route.points.map(([lat, lng]) => [lat, lng] as [number, number]),
          { color: COLOR.route, weight: 4, opacity: 0.8 },
        ).addTo(map);
        bounds.extend(line.getBounds());
        const first = route.points[0];
        if (first !== undefined) {
          L.circleMarker([first[0], first[1]], {
            radius: 5,
            color: COLOR.route,
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 2,
          })
            .bindTooltip('First position today')
            .addTo(map);
        }
      }
      for (const pin of pins) {
        const color = pin.selected ? COLOR.selected : pin.stale ? COLOR.stale : COLOR.pin;
        const marker = L.circleMarker([pin.latitude, pin.longitude], {
          radius: pin.selected ? 10 : 8,
          color: '#ffffff',
          weight: 2,
          fillColor: color,
          fillOpacity: pin.stale ? 0.6 : 0.95,
        })
          .bindTooltip(tooltipHtml(pin.label), {
            permanent: pins.length <= 12,
            direction: 'top',
            offset: [0, -8],
          })
          .addTo(map);
        marker.on('click', () => {
          router.push(`/tracking?rep=${encodeURIComponent(pin.mrId)}`);
        });
        bounds.extend([pin.latitude, pin.longitude]);
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [pins, route, router]);

  if (pins.length === 0) return null;
  return (
    <div
      ref={holder}
      className="ff-map"
      role="region"
      aria-label="Map of your reps' newest positions"
      style={{ height: 420, width: '100%', borderRadius: 12, overflow: 'hidden', zIndex: 0 }}
    />
  );
};

/**
 * `FE-W208` — keeps the page live: the server render is asked for again every `seconds` while the
 * tab is visible, and the time of the last read is shown, so a manager never wonders how fresh it is.
 */
export const LiveRefresh = ({ seconds = 60 }: { readonly seconds?: number }): ReactNode => {
  const router = useRouter();
  const [readAt, setReadAt] = useState(() => new Date());
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setReadAt(new Date());
    };
    const timer = window.setInterval(tick, seconds * 1000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, seconds]);
  const time = readAt.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
  return (
    <p className="ff-muted" aria-live="polite">
      Live: updated {time} IST, again every {String(seconds)} seconds while this page is open.
    </p>
  );
};
