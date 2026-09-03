import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { Screen, Spinner } from '@fieldforce/ui';
import { useSession } from '../src/session';
import { hasCompletedFirstRun } from '../src/onboarding/progress';

/**
 * The entry route decides where a cold start lands. Nothing renders here — the
 * session has to be read from disk first, and guessing produces a login screen
 * flashing at an MR who is already signed in.
 */
export default function Index(): ReactNode {
  const { status } = useSession();
  const [firstRunDone, setFirstRunDone] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void hasCompletedFirstRun().then((done) => {
      if (live) setFirstRunDone(done);
    });
    return () => {
      live = false;
    };
  }, []);

  // Both facts come off disk, and neither is guessed. Redirecting before the flag
  // resolves would send a returning MR through setup they finished weeks ago.
  if (status === 'loading' || firstRunDone === null) {
    return (
      <Screen>
        <Spinner label="Restoring your session" />
      </Screen>
    );
  }

  if (status !== 'signed-in') return <Redirect href="/sign-in" />;

  /*
    First run goes through Flow A. The order is the design's, minus one screen:
    A2 (location) is NOT here, because `shouldPromptForLocation` is only ever true
    for an explicit user request. Putting location in a forced sequence would be
    the nag loop that `src/onboarding/permissions.ts` exists to prevent, and the
    ask now happens where it belongs — on the check-in press that needs a position.

    The microphone is absent for the same kind of reason: `shouldPromptForMicrophone`
    is false at sign-in and true at the first visit.
  */
  return firstRunDone ? <Redirect href="/home" /> : <Redirect href="/onboarding/notifications" />;
}
