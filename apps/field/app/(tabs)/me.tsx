import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Banner, Button, Screen, SettingsScreen, useT } from '@fieldforce/ui';
import {
  assistantEnabled,
  practiceEnabled,
  productQaEnabled,
  learningEnabled,
  liveTrackingEnabled,
} from '../../src/features';
import { useSession } from '../../src/session';
import { settingsGroups } from '../../src/settings/content';
import { chooseAppLanguage } from '../../src/settings/language-pref';
import {
  queueUnreadable,
  loadQueueState,
  onQueueChanged,
} from '../../src/sync/async-storage-store';
import { unsentBeforeSignOut } from '../../src/sync/indicator';
import { LiveTrackingStatusLine } from '../../src/tracking/status-line';

/**
 * C4 — route binding. The entries and their honest states live in
 * `src/settings/content.ts` next to the note explaining what is missing and why.
 */
export default function Me(): ReactNode {
  // `FE-W142`. Subscribed: choosing a language below repaints this screen, the rows included.
  const { t } = useT();
  const router = useRouter();
  const { signOut } = useSession();
  const [signOutFailed, setSignOutFailed] = useState(false);
  /** `FE-W142`. The language took effect but the phone could not keep it; it lasts until restart. */
  const [languageUnsaved, setLanguageUnsaved] = useState(false);
  /**
   * MR-49 / `FE-W61`. What this MR has not sent, read BEFORE they sign out. Their queue now
   * stays under their account when they do; this is where they are told so, rather than the
   * work being kept -- or, before MR-49, handed to the next person -- without a word.
   */
  const [unsent, setUnsent] = useState<
    | { readonly kind: 'unreadable' }
    | { readonly kind: 'items'; readonly items: readonly { readonly status: string }[] }
    | null
  >(null);
  useEffect(() => {
    let live = true;
    // W2-B C / `BE-W151`. Re-read on every change to the queue, not once per mount: on the emulator
    // this told a rep signing out "21 things have not been sent yet" after all 21 had been.
    const read = (): void => {
      void loadQueueState().then((load) => {
        if (!live) return;
        // `FE-W142`. The queue is kept, not its sentence, so the warning is worded at render time in
        // whatever language the app is in by then.
        setUnsent(
          load.kind === 'unreadable'
            ? { kind: 'unreadable' }
            : { kind: 'items', items: load.state.items },
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

  const unsentWarning =
    unsent === null
      ? null
      : unsent.kind === 'unreadable'
        ? { title: t('me.queueUnreadable'), detail: queueUnreadable() }
        : unsentBeforeSignOut(unsent.items);

  return (
    <Screen scrollable>
      <SettingsScreen
        // `FE-W71`. What live location is doing, before everything else on Me (under the title,
        // `FE-W126`); nothing when it is off.
        lead={
          <LiveTrackingStatusLine
            onOpen={() => {
              router.push('/live-tracking');
            }}
          />
        }
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
          // `FE-W139`. Both "Your data" rows open the one Mobile data screen.
          onOpenDataSettings: () => {
            router.push('/data-settings');
          },
          // `FE-W142`. Only a complete language is offered, so a refusal here would be a defect in
          // the row, not something to tell the rep; an unsaved choice is said, under the rows.
          onChooseLanguage: (language) => {
            void chooseAppLanguage(language).then((outcome) => {
              setLanguageUnsaved(outcome === 'unsaved');
            });
          },
          // FE-D15 / W2-G A. Only with the assistant flag on; off, the row does not exist.
          ...(assistantEnabled
            ? {
                onOpenAssistant: () => {
                  router.push('/assistant');
                },
              }
            : {}),
          // FE-D17 / W2-G A. Only with the practice flag on; off, the row does not exist.
          ...(practiceEnabled
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
          // `FE-W71`. Only with the live tracking flag on; off, the row does not exist.
          ...(liveTrackingEnabled
            ? {
                onOpenLiveTracking: () => {
                  router.push('/live-tracking');
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
      {languageUnsaved ? (
        <Banner
          tone="attention"
          title={t('me.languageUnsaved')}
          detail={t('me.languageUnsavedDetail')}
        />
      ) : null}

      {unsentWarning === null ? null : (
        <Banner tone="attention" title={unsentWarning.title} detail={unsentWarning.detail} />
      )}

      {signOutFailed ? (
        <Banner
          tone="critical"
          title={t('me.stillSignedIn')}
          detail={t('me.stillSignedInDetail')}
        />
      ) : null}

      <Button
        label={t('me.signOut')}
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
