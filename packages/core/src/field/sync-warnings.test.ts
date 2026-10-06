import { describe, expect, it } from 'vitest';
import { knownSyncWarnings } from './sync.js';

/**
 * W2-B A / `BE-W147` — the warnings this build knows, out of the wire's open `string[]`.
 *
 * Written here, in core, after the client mutant that removed the filter SURVIVED: the field app
 * resolves `@fieldforce/core` to its BUILT `dist/`, so a change to this source never reached the
 * field tests that looked as if they covered it.
 */
describe('knownSyncWarnings', () => {
  it('keeps the warnings this build knows, in order', () => {
    expect(
      knownSyncWarnings([
        'check_in_location_approximate',
        'stale_beat_plan',
        'check_in_outside_geofence',
      ]),
    ).toEqual(['check_in_location_approximate', 'stale_beat_plan', 'check_in_outside_geofence']);
  });

  it('DROPS one it does not know, rather than failing the push or passing it through', () => {
    expect(knownSyncWarnings(['check_in_outside_geofence', 'a_warning_from_the_future'])).toEqual([
      'check_in_outside_geofence',
    ]);
  });

  it('is empty for nothing', () => {
    expect(knownSyncWarnings([])).toEqual([]);
  });
});
