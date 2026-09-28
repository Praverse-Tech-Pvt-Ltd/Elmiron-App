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
    First run goes through Flow A, in the design's order: A2 location → A3
    notifications → battery → A9 transparency.

    FE-D2 (operator ruling, 28 September). This comment used to explain why A2 was left
    OUT, as a nag loop. It is back in as the second screen. It is not a loop: A2 is shown
    once, the system prompt appears only when the rep presses "Turn location on" (an
    explicit request — the one trigger `shouldPromptForLocation` allows), and "Not now"
    is a full-weight answer that simply goes on. A denial lands on S4, once.

    The microphone is still absent here: `shouldPromptForMicrophone` is false at sign-in,
    and A4 comes before the rep's first visit.
  */
  return firstRunDone ? <Redirect href="/home" /> : <Redirect href="/onboarding/location" />;
}
