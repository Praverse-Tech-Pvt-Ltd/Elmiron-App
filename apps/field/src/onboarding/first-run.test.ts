import { describe, expect, it, vi } from 'vitest';

vi.mock('./progress', () => ({ hasCompletedFirstRun: () => Promise.resolve(false) }));

const { firstRunPosition, firstRunSteps } = await import('./first-run');
const { locationClaim } = await import('./location-claim');
const { t } = await import('@fieldforce/ui/i18n');

/** `FE-W192`. First run's "Step n of N". */
describe('firstRunPosition', () => {
  it('counts four steps where the phone has battery settings', () => {
    expect(firstRunSteps(true)).toEqual(['location', 'notifications', 'battery', 'transparency']);
    expect(firstRunPosition('notifications', true)).toEqual({ n: 2, total: 4 });
    expect(firstRunPosition('transparency', true)).toEqual({ n: 4, total: 4 });
  });

  it('counts three where it has none (an iPhone)', () => {
    expect(firstRunPosition('location', false)).toEqual({ n: 1, total: 3 });
    expect(firstRunPosition('transparency', false)).toEqual({ n: 3, total: 3 });
  });
});

/**
 * `FE-W185`. The first-run location screen said "This app never asks your phone for a position at
 * any other moment" while live location could be on. Each sentence is now the true one.
 */
describe('locationClaim', () => {
  it('without live location for this rep, says check-in and check-out only', () => {
    const claim = locationClaim({ liveBuild: false, trackerState: null });
    expect(t(claim.detail)).toMatch(/never asks your phone for a position at any other moment/u);
    // A build with the flag on, for a user with no tracker (not a rep): still only the presses.
    expect(locationClaim({ liveBuild: true, trackerState: null })).toEqual(claim);
  });

  it('where live location exists, never claims "never at any other moment"', () => {
    for (const state of [
      'off_company',
      'off_no_notice',
      'paused_outside_hours',
      'paused_day_closed',
      'paused_background',
      'active',
    ] as const) {
      const claim = locationClaim({ liveBuild: true, trackerState: state });
      expect(t(claim.detail)).not.toMatch(/any other moment/u);
      expect(t(claim.detail)).toMatch(/every few minutes during your working hours/u);
    }
  });

  it('while sharing, says so first and where to stop', () => {
    const claim = locationClaim({ liveBuild: true, trackerState: 'active' });
    expect(t(claim.title)).toBe('You are sharing live location now');
    expect(t(claim.detail)).toMatch(/Stop sharing any time from Live location/u);
  });
});
