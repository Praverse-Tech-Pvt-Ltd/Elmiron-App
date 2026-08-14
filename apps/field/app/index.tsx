import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { Screen, Spinner } from '@elmiron/ui';
import { useSession } from '../src/session';

/**
 * The entry route decides where a cold start lands. Nothing renders here — the
 * session has to be read from disk first, and guessing produces a login screen
 * flashing at an MR who is already signed in.
 */
export default function Index(): ReactNode {
  const { status } = useSession();

  if (status === 'loading') {
    return (
      <Screen>
        <Spinner label="Restoring your session" />
      </Screen>
    );
  }

  return status === 'signed-in' ? <Redirect href="/home" /> : <Redirect href="/sign-in" />;
}
