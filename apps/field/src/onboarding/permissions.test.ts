import { describe, expect, it } from 'vitest';
import {
  checkInMethodsFor,
  persistentBannerFor,
  reachableRoutes,
  REACHABLE_ROUTES,
  REQUESTS_BACKGROUND_LOCATION,
  shouldPromptForLocation,
  shouldPromptForMicrophone,
} from './permissions';
import type { LocationAskTrigger, OnboardingPermissions, PermissionState } from './permissions';

const STATES: readonly PermissionState[] = ['granted', 'denied', 'undetermined'];

/** All 27 permission combinations. The properties below hold across every one. */
const ALL_COMBINATIONS: readonly OnboardingPermissions[] = STATES.flatMap((location) =>
  STATES.flatMap((notifications) =>
    STATES.map((microphone) => ({ location, notifications, microphone })),
  ),
);

const granted: OnboardingPermissions = {
  location: 'granted',
  notifications: 'granted',
  microphone: 'granted',
};

const locationDenied: OnboardingPermissions = {
  location: 'denied',
  notifications: 'granted',
  microphone: 'undetermined',
};

describe('rule 1 — denial blocks no route', () => {
  it('offers a location-denied MR exactly the routes a granted one gets', () => {
    // THE REQUIREMENT, ASSERTED AS AN EQUALITY BETWEEN TWO COMPUTED LISTS.
    //
    // A test that only rendered S4 and checked its text would pass while every route
    // in the app was gated behind a location check. This compares the reachable set
    // in the denied state against the granted state and fails if they ever diverge.
    expect(reachableRoutes(locationDenied)).toEqual(reachableRoutes(granted));
  });

  it('reaches every declared route in all 27 permission combinations', () => {
    for (const permissions of ALL_COMBINATIONS) {
      expect(reachableRoutes(permissions), `${JSON.stringify(permissions)} lost a route`).toEqual(
        REACHABLE_ROUTES,
      );
    }
  });

  it('declares the routes this app actually has', () => {
    // Guards the test above from passing vacuously: if REACHABLE_ROUTES were emptied
    // or trimmed, the equality checks would still hold and prove nothing.
    expect(REACHABLE_ROUTES).toContain('/home');
    expect(REACHABLE_ROUTES).toContain('/queue');
    expect(REACHABLE_ROUTES).toContain('/onboarding/battery');
    expect(REACHABLE_ROUTES.length).toBeGreaterThanOrEqual(7);
  });
});

describe('rule 2 — no banner persists across screens', () => {
  it('returns no persistent banner in any permission state', () => {
    for (const permissions of ALL_COMBINATIONS) {
      expect(persistentBannerFor(permissions)).toBeNull();
    }
  });
});

describe('rule 3 — no nag loop', () => {
  const NAGGING_TRIGGERS: readonly LocationAskTrigger[] = [
    'app-launch',
    'screen-focus',
    'elapsed-time',
  ];

  it.each(NAGGING_TRIGGERS)('does not prompt on %s', (trigger) => {
    expect(shouldPromptForLocation(trigger, locationDenied)).toBe(false);
  });

  it('does not start prompting after many launches', () => {
    // There is no attempt counter to advance, and that is the point: a backoff is a
    // design for asking repeatedly. Simulated anyway, because "we ask again after a
    // week" is the change most likely to be added later without anyone calling it a
    // nag.
    for (let launch = 0; launch < 500; launch += 1) {
      expect(shouldPromptForLocation('app-launch', locationDenied)).toBe(false);
      expect(shouldPromptForLocation('elapsed-time', locationDenied)).toBe(false);
    }
  });

  it('prompts only when the MR asks for it', () => {
    expect(shouldPromptForLocation('explicit-user-request', locationDenied)).toBe(true);
  });

  it('does not re-prompt someone who already granted it', () => {
    expect(shouldPromptForLocation('explicit-user-request', granted)).toBe(false);
  });
});

describe('manual check-in is first-class', () => {
  it('is available whether or not location was granted', () => {
    for (const permissions of ALL_COMBINATIONS) {
      expect(checkInMethodsFor(permissions)).toContain('manual');
    }
  });

  it('is the only method when location is denied, and still a method when granted', () => {
    // Denial removes the automatic path and nothing else. Manual is not a degraded
    // mode that appears when something breaks — it is there in both states.
    expect(checkInMethodsFor(locationDenied)).toEqual(['manual']);
    expect(checkInMethodsFor(granted)).toContain('automatic');
    expect(checkInMethodsFor(granted)).toContain('manual');
  });
});

describe('the microphone deferral', () => {
  it('is never requested at sign-in', () => {
    for (const permissions of ALL_COMBINATIONS) {
      expect(shouldPromptForMicrophone('sign-in', permissions)).toBe(false);
    }
  });

  it('is requested at the first visit, once', () => {
    expect(shouldPromptForMicrophone('first-visit', locationDenied)).toBe(true);
    // Already answered, either way: not asked again.
    expect(shouldPromptForMicrophone('first-visit', granted)).toBe(false);
    expect(shouldPromptForMicrophone('first-visit', { ...granted, microphone: 'denied' })).toBe(
      false,
    );
  });
});

describe('background location', () => {
  it('is not requested by this sprint', () => {
    // Android will not grant it in the same prompt as foreground location, and
    // FE-W3-SPEC raises the Play declaration as an open decision for a human.
    // Asserted so that turning it on is a visible change to a test, not a quiet edit
    // to a manifest.
    expect(REQUESTS_BACKGROUND_LOCATION).toBe(false);
  });
});
