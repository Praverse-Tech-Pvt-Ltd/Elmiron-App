import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Screen, TransparencyScreen } from '@fieldforce/ui';
import { hasCompletedFirstRun, markFirstRunComplete } from '../src/onboarding/progress';
import {
  NEVER_RECORDED,
  TRANSPARENCY_ENTRIES,
  TRANSPARENCY_PREAMBLE,
} from '../src/transparency/content';

/**
 * A9 / C10 — reachable from Home, every day, and never buried in settings.
 *
 * Route binding only. The copy lives in `src/transparency/content.ts` next to its
 * sourcing note, and the screen lives in `packages/ui`; this file exists to join
 * them.
 *
 * **One screen, two ways in, and the action differs.** Reached at the end of first
 * run it carries "Start my first day", which is what closes first run. Reached from
 * Today at 14:00 it carries nothing — a button that restarts onboarding mid-shift
 * would be a trap, and the design asks for this screen to be openable *any time*.
 *
 * Which one it is comes off disk rather than from a route parameter: a parameter
 * can be forged by a deep link, and "have you finished setup" is a fact about the
 * handset.
 */
export default function Transparency(): ReactNode {
  const router = useRouter();
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

  return (
    <Screen scrollable>
      <TransparencyScreen
        entries={TRANSPARENCY_ENTRIES}
        neverRecorded={NEVER_RECORDED}
        preamble={TRANSPARENCY_PREAMBLE}
        {...(inFirstRun === true
          ? {
              onContinue: () => {
                void markFirstRunComplete(new Date().toISOString()).then(() => {
                  router.replace('/home');
                });
              },
            }
          : {})}
      />
    </Screen>
  );
}
