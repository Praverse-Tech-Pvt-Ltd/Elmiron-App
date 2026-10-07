import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Banner, Button, Screen, SettingsScreen } from '@fieldforce/ui';
import {
  assistantSampleEnabled,
  practiceSampleEnabled,
  productQaEnabled,
  learningEnabled,
} from '../../src/features';
import { useSession } from '../../src/session';
import { settingsGroups } from '../../src/settings/content';
import {
  QUEUE_UNREADABLE,
  loadQueueState,
  onQueueChanged,
} from '../../src/sync/async-storage-store';
import { unsentBeforeSignOut } from '../../src/sync/indicator';

/**
 * C4 — route binding. The entries and their honest states live in
 * `src/settings/content.ts` next to the note explaining what is missing and why.
 */
export default function Me(): ReactNode {
  const router = useRouter();
  const { signOut } = useSession();
  const [signOutFailed, setSignOutFailed] = useState(false);
  /**
   * MR-49 / `FE-W61`. What this MR has not sent, read BEFORE they sign out. Their queue now
   * stays under their account when they do; this is where they are told so, rather than the
   * work being kept -- or, before MR-49, handed to the next person -- without a word.
   */
  const [unsent, setUnsent] = useState<{ title: string; detail: string } | null>(null);
  useEffect(() => {
    let live = true;
    // W2-B C / `BE-W151`. Re-read on every change to the queue, not once per mount: on the emulator
    // this told a rep signing out "21 things have not been sent yet" after all 21 had been.
    const read = (): void => {
      void loadQueueState().then((load) => {
        if (!live) return;
        setUnsent(
          load.kind === 'unreadable'
            ? { title: 'This app could not read your queue', detail: QUEUE_UNREADABLE }
            : unsentBeforeSignOut(load.state.items),
        );
      });
    };
    read();
    const stop = onQueueChanged(read);
    return () => {
      live = false;
      stop();
    };
  }, []);

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
          // FE-D15. Only with the sample flag on; off, the row does not exist.
          ...(assistantSampleEnabled
            ? {
                onOpenAssistant: () => {
                  router.push('/assistant');
                },
              }
            : {}),
          // FE-D17. Only with the practice sample flag on; off, the row does not exist.
          ...(practiceSampleEnabled
            ? {
                onOpenPractice: () => {
                  router.push('/practice');
                },
              }
            : {}),
          // W2-C C / `BE-W160`. Only with the Product Q&A flag on; off, the row does not exist.
          ...(productQaEnabled
            ? {
                onOpenProductQa: () => {
                  router.push('/product-qa');
                },
              }
            : {}),
          // W2-F B. Only with the learning flag on; off, the row does not exist.
          ...(learningEnabled
            ? {
                onOpenLearning: () => {
                  router.push('/learning');
                },
              }
            : {}),
        })}
      />

      {/*
        Sign out lives here rather than on Today. It was a full-accent button
        beside "Start the visit to …", which made two primary actions on the screen
        an MR looks at most — and the one that ends their session was the same
        weight as the one that starts their work.
      */}
      {unsent === null ? null : (
        <Banner tone="attention" title={unsent.title} detail={unsent.detail} />
      )}

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
