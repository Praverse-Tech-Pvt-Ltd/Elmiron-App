import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Button, Screen, SettingsScreen } from '@fieldforce/ui';
import { useSession } from '../../src/session';
import { settingsGroups } from '../../src/settings/content';

/**
 * C4 — route binding. The entries and their honest states live in
 * `src/settings/content.ts` next to the note explaining what is missing and why.
 */
export default function Me(): ReactNode {
  const router = useRouter();
  const { signOut } = useSession();

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
      <Button
        label="Sign out"
        onPress={() => {
          void signOut();
        }}
        variant="secondary"
      />
    </Screen>
  );
}
