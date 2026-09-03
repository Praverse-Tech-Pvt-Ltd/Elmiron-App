import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useSession } from './session';

/**
 * Sends every route to the right side of the sign-in boundary.
 *
 * **Why this is here and not in `sign-in.tsx`.** It used to be nowhere. The screen
 * called `signIn`, GoTrue returned 200 with the right claims, and then nothing
 * happened — the only redirect in the app lived in `app/index.tsx`, which is not
 * re-rendered once you are on `/sign-in`. An MR would have tapped, seen the screen
 * sit still, and tapped again. Two successful logins were recorded that way before
 * anyone noticed, and roughly six hundred tests had never asserted the primary path
 * of the application.
 *
 * A `router.replace` bolted into the submit handler would have fixed that one
 * screen and left the next entry point broken by default, which is exactly how the
 * defect happened in the first place. The rule belongs at the root, stated once:
 * signed-in users do not sit on `/sign-in`, signed-out users do not sit anywhere
 * else.
 *
 * `loading` does nothing deliberately. The stored session is read from disk
 * asynchronously, and redirecting before it resolves throws a signed-in MR back to
 * the login screen on every cold start.
 */
export const AuthGate = ({ children }: { readonly children: ReactNode }): ReactNode => {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    const onSignIn = segments[0] === 'sign-in';

    if (status === 'signed-in' && onSignIn) {
      // To `/`, not `/home`. The entry route decides between first-run setup and
      // the day, and it needs to read that flag off disk. Sending them straight to
      // `/home` from here put a brand-new MR on Today having never seen the battery
      // setup — the same class of bug this file's own comment describes, where one
      // entry point is fixed and the next is left broken by default.
      router.replace('/');
      return;
    }
    // `index` is the entry route; it does its own redirect and must not be fought
    // over here, or the two race and the app flickers between them.
    //
    // Widened to `readonly string[]` on purpose. `useSegments()` is typed from the
    // generated route union, which since Phase 2's routes landed no longer admits
    // the empty list — so a type-aware lint reads the length check as always true.
    // It is not: standing on `/` really does give zero segments, and dropping the
    // check would restore the flicker this comment exists to prevent.
    const path: readonly string[] = segments;

    if (status === 'signed-out' && !onSignIn && path.length > 0) {
      router.replace('/sign-in');
    }
  }, [status, segments, router]);

  return children;
};
