import { useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Banner, Button, Screen, SettingsScreen } from '@fieldforce/ui';
import { useSession } from '../../src/session';
import { settingsGroups } from '../../src/settings/content';

/**
 * C4 — route binding. The entries and their honest states live in
 * `src/settings/content.ts` next to the note explaining what is missing and why.
 */
export default function Me(): ReactNode {
  const router = useRouter();
  const { signOut } = useSession();
  const [signOutFailed, setSignOutFailed] = useState(false);

  return (
    <Screen scrollable>
      <SettingsScreen
        groups={settingsGroups({
          onOpenMileage: () => {
            router.push('/mileage');
          },
          onOpenDayEnd: () => {
            router.push('/day-end');
          },
          onOpenBattery: () => {
            router.push('/onboarding/battery');
          },
          onOpenTransparency: () => {
            router.push('/transparency');
          },
          onOpenLocation: () => {
            router.push('/onboarding/location');
          },
        })}
      />

      {/*
        Sign out lives here rather than on Today. It was a full-accent button
        beside "Start the visit to …", which made two primary actions on the screen
        an MR looks at most — and the one that ends their session was the same
        weight as the one that starts their work.
      */}
      {signOutFailed ? (
        <Banner
          tone="critical"
          title="You are still signed in"
          detail="Sign out did not go through. Try again — and if you are handing this phone to somebody else, do not until it does."
        />
      ) : null}

      <Button
        label="Sign out"
        onPress={() => {
          setSignOutFailed(false);
          // **MR-28 C2.** This was `void signOut();` — outcome discarded, no failure path.
          //
          // The one place that matters more than the rest: this app runs on SHARED
          // handsets, and "I pressed sign out" is how an MR hands the phone over. A
          // sign-out that fails silently leaves the next person holding somebody else's
          // day, and the screen gives no sign of it.
          void signOut().catch(() => {
            setSignOutFailed(true);
          });
        }}
        variant="secondary"
      />
    </Screen>
  );
}
