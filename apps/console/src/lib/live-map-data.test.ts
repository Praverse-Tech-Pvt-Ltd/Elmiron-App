import { describe, expect, it } from 'vitest';
import type { TeamRep, TrackingTrail } from '@fieldforce/core';
import {
  DEFAULT_TILE_URL,
  STALE_AFTER_SECONDS,
  agoLabel,
  haversineKm,
  kilometresLabel,
  mapPins,
  mapRoute,
  tileUrl,
  tooltipHtml,
  trailKilometres,
} from './live-map-data';

const rep = (mrId: string, latest: { lat: number; lng: number; age: number } | null): TeamRep =>
  ({
    mrId,
    fullName: `Rep ${mrId}`,
    latest:
      latest === null
        ? null
        : {
            latitude: latest.lat,
            longitude: latest.lng,
            ageSeconds: latest.age,
            accuracyM: 20,
            receivedAt: '2026-11-11T05:00:00Z',
          },
  }) as unknown as TeamRep;

const trail = (points: readonly (readonly [number, number])[]): TrackingTrail =>
  ({
    fullName: 'Rep a',
    day: '2026-11-11',
    timeZone: 'Asia/Kolkata',
    points: points.map(([latitude, longitude], i) => ({
      id: String(i),
      latitude,
      longitude,
      accuracyM: 20,
      receivedAt: '2026-11-11T05:00:00Z',
      recordedAt: '2026-11-11T05:00:00Z',
    })),
  }) as unknown as TrackingTrail;

describe('FE-W208 the live location map', () => {
  it('pins every rep with a position, and only those; the chosen one is marked', () => {
    const pins = mapPins(
      [
        rep('a', { lat: 19, lng: 72, age: 120 }),
        rep('b', null),
        rep('c', { lat: 18, lng: 73, age: 7200 }),
      ],
      'c',
    );
    expect(pins.map((pin) => pin.mrId)).toEqual(['a', 'c']);
    expect(pins[0]).toMatchObject({ label: 'Rep a · 2 min ago', stale: false, selected: false });
    expect(pins[1]).toMatchObject({ stale: true, selected: true });
  });

  it('marks a position stale only past the threshold', () => {
    expect(mapPins([rep('a', { lat: 1, lng: 1, age: STALE_AFTER_SECONDS })], null)[0]?.stale).toBe(
      false,
    );
    expect(
      mapPins([rep('a', { lat: 1, lng: 1, age: STALE_AFTER_SECONDS + 1 })], null)[0]?.stale,
    ).toBe(true);
  });

  it('words an age plainly', () => {
    expect(agoLabel(30)).toBe('just now');
    expect(agoLabel(600)).toBe('10 min ago');
    expect(agoLabel(3600)).toBe('1 h ago');
    expect(agoLabel(5400)).toBe('1 h 30 min ago');
    expect(agoLabel(86400)).toBe('1 day ago');
    expect(agoLabel(3 * 86400)).toBe('3 days ago');
  });

  it('draws no route for no trail or an empty day', () => {
    expect(mapRoute(null)).toBeNull();
    expect(mapRoute(trail([]))).toBeNull();
    expect(trailKilometres(trail([]))).toBeNull();
  });

  it('measures straight-line kilometres between kept positions', () => {
    // Mumbai CST to Pune station is about 120 km as the crow flies.
    const km = haversineKm([18.9398, 72.8355], [18.5285, 73.8743]);
    expect(km).toBeGreaterThan(115);
    expect(km).toBeLessThan(125);
    expect(trailKilometres(trail([[19, 72]]))).toBe(0);
    const there =
      trailKilometres(
        trail([
          [0, 0],
          [0, 1],
          [0, 0],
        ]),
      ) ?? 0;
    expect(there).toBeCloseTo(2 * 111.19, 0);
    expect(kilometresLabel(3.14)).toBe('3.1 km');
    expect(kilometresLabel(42.6)).toBe('43 km');
  });

  it('uses OpenStreetMap unless a well-formed https tile URL is configured', () => {
    expect(tileUrl(undefined)).toBe(DEFAULT_TILE_URL);
    expect(tileUrl('http://tiles.example/{z}/{x}/{y}.png')).toBe(DEFAULT_TILE_URL);
    expect(tileUrl('nonsense')).toBe(DEFAULT_TILE_URL);
    expect(tileUrl(' https://tiles.example/{z}/{x}/{y}.png ')).toBe(
      'https://tiles.example/{z}/{x}/{y}.png',
    );
  });
});

describe('FE-W218 — a rep’s name on the map is text, never markup', () => {
  it('escapes everything Leaflet would otherwise read as HTML', () => {
    expect(tooltipHtml('<img src=x onerror="alert(1)"> · 2 min ago')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; · 2 min ago',
    );
    expect(tooltipHtml("O'Brien & Sons")).toBe('O&#39;Brien &amp; Sons');
  });

  it('POSITIVE CONTROL: an ordinary name is unchanged', () => {
    expect(tooltipHtml('Asha Kulkarni · 2 min ago')).toBe('Asha Kulkarni · 2 min ago');
  });
});
