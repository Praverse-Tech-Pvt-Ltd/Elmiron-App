import { useEffect, useState } from 'react';
import { hasCompletedFirstRun } from './progress';

/**
 * `FE-W192` — where a first-run screen sits in first run, for its "Step 2 of 4" line.
 *
 * First run is a known chain (`FE-D2`, the design's order): location → notifications → battery and
 * autostart (only where the phone has those settings, `batteryStepApplies`) → what this app
 * records. S4 (location denied) is a branch of the first step, not a step of its own. The
 * microphone is asked at the first visit, not here, so it is not counted.
 *
 * A rep told "Step 2 of 4" knows the setup ends, and roughly when — the thing a chain of
 * permission screens with no end in sight does not tell them.
 */
export type FirstRunStep = 'location' | 'notifications' | 'battery' | 'transparency';

export const firstRunSteps = (batteryApplies: boolean): readonly FirstRunStep[] =>
  batteryApplies
    ? ['location', 'notifications', 'battery', 'transparency']
    : ['location', 'notifications', 'transparency'];

export const firstRunPosition = (
  step: FirstRunStep,
  batteryApplies: boolean,
): { readonly n: number; readonly total: number } => {
  const steps = firstRunSteps(batteryApplies);
  return { n: steps.indexOf(step) + 1, total: steps.length };
};

/**
 * Whether this screen is being shown IN first run (true), or was opened later from Me (false);
 * null until the phone has answered. Read off disk, as `transparency.tsx` does, not from a route
 * parameter a link could forge. A failed read answers "in first run" (`hasCompletedFirstRun`).
 */
export const useInFirstRun = (): boolean | null => {
  const [inFirstRun, setInFirstRun] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void hasCompletedFirstRun().then((done) => {
      if (live) setInFirstRun(!done);
    });
    return () => {
      live = false;
    };
  }, []);
  return inFirstRun;
};
