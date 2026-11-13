import { describe, expect, it } from 'vitest';
import { deliver, fixesFrom, usesScreenOffService } from './screen-off';
import type { ScreenOffFix } from './screen-off';

const location = (
  latitude: unknown,
  longitude: unknown,
  timestamp: unknown,
  accuracy?: unknown,
) => ({
  coords: { latitude, longitude, accuracy },
  timestamp,
});

describe('FE-W207 screen-off live location — the pure half', () => {
  it('reads expo-location batches oldest first, with accuracy when the phone gave one', () => {
    const fixes = fixesFrom({
      locations: [location(19.07, 72.87, 2000, 12), location(19.06, 72.86, 1000)],
    });
    expect(fixes).toEqual([
      { latitude: 19.06, longitude: 72.86, accuracyM: null, timestampMs: 1000 },
      { latitude: 19.07, longitude: 72.87, accuracyM: 12, timestampMs: 2000 },
    ]);
  });

  it('drops malformed and impossible positions instead of sending NaN', () => {
    expect(
      fixesFrom({
        locations: [
          location('19', 72, 1000),
          location(19, Number.NaN, 1000),
          location(91, 72, 1000),
          location(19, 181, 1000),
          location(19, 72, undefined),
          {},
        ],
      }),
    ).toEqual([]);
    expect(fixesFrom(null)).toEqual([]);
    expect(fixesFrom({ locations: 'no' })).toEqual([]);
  });

  it('with no tracker in this process, sends nothing and tells the caller to stop the service', () => {
    expect(deliver({ locations: [location(19, 72, 1000)] }, null, null)).toBe('stop');
  });

  it('hands every position to the tracker, and nothing on an error', () => {
    const seen: ScreenOffFix[] = [];
    const sink = { onFix: (fix: ScreenOffFix) => seen.push(fix) };
    expect(deliver({ locations: [location(19, 72, 1000)] }, null, sink)).toBe('delivered');
    expect(seen).toHaveLength(1);
    expect(deliver({ locations: [location(19, 72, 1000)] }, new Error('x'), sink)).toBe('nothing');
    expect(deliver({ locations: [] }, null, sink)).toBe('nothing');
    expect(seen).toHaveLength(1);
  });

  it('runs only on Android and only when the build turns it on', () => {
    expect(usesScreenOffService('android', true)).toBe(true);
    expect(usesScreenOffService('android', false)).toBe(false);
    expect(usesScreenOffService('ios', true)).toBe(false);
  });
});
