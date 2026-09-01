import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { OemBatteryScreen } from '@fieldforce/ui';
import type { SetupStepView } from '@fieldforce/ui';
import { detectDeviceOem, deviceLauncher } from '../../src/onboarding/device';
import { intentsFor } from '../../src/onboarding/intents';
import type { SettingsIntent } from '../../src/onboarding/intents';
import { launchSettings, offerableIntents } from '../../src/onboarding/launch';
import { contentFor } from '../../src/onboarding/oem-content';

/**
 * Screens A5-A8, chosen by the build rather than by the MR.
 *
 * There is no picker and no route parameter for the family. The design's premise is
 * that the MR never has to know whether their Realme runs "Realme UI" or "ColorOS",
 * and a `?family=` in the URL is that question asked in a different place.
 *
 * The three moving parts and where they live:
 *   - which skin      -> `detectDeviceOem()`, pure mapping over `Platform.constants`
 *   - what it says    -> `contentFor()`, copy as data
 *   - which shortcuts -> `offerableIntents()`, probed on this device, usually none
 *
 * The done state lives here. It is deliberately **not persisted**: these are settings
 * on the phone, not in the app, and the app cannot read back whether the MR actually
 * changed them. A tick that survives a restart would be the app asserting something
 * it does not know. It is a checklist the MR keeps for themselves while they work
 * through the list, and it is honest only for as long as they are on the screen.
 */
export default function BatterySetup(): ReactNode {
  const router = useRouter();
  const family = detectDeviceOem();
  const content = contentFor(family);

  const [offered, setOffered] = useState<readonly SettingsIntent[]>([]);
  const [done, setDone] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Rule 1: probe before offering. Until this resolves, `offered` is empty and the
    // screen renders its zero-shortcut form — which is also its final form on most
    // devices, so there is no spinner and nothing to wait for.
    let live = true;
    void offerableIntents(intentsFor(family), deviceLauncher).then((intents) => {
      if (live) setOffered(intents);
    });
    return () => {
      live = false;
    };
  }, [family]);

  const open = useCallback((intent: SettingsIntent): void => {
    void launchSettings(intent, deviceLauncher).then((outcome) => {
      // Every outcome is a sentence, and none of them is an error. `launchSettings`
      // cannot reject, so there is no `.catch` here to forget.
      setNotice(
        outcome === 'opened'
          ? null
          : `Could not open ${intent.destination} on this phone. The steps above still work.`,
      );
    });
  }, []);

  const steps: readonly SetupStepView[] = content.steps.map((step, index) => {
    const shortcut = offered.find((intent) => intent.id === step.intentId);
    return {
      // Steps have no ids of their own in the content — position is the identity, and
      // it is stable because the list is a constant.
      id: `${content.family}-${String(index)}`,
      title: step.title,
      whatYouWillSee: step.whatYouWillSee,
      done: done.includes(`${content.family}-${String(index)}`),
      shortcut:
        shortcut === undefined
          ? undefined
          : {
              label: 'Open that settings screen',
              onPress: () => {
                open(shortcut);
              },
            },
    };
  });

  return (
    <OemBatteryScreen
      skin={content.skin}
      headline={content.headline}
      consequence={content.consequence}
      steps={steps}
      notice={notice}
      onToggleDone={(id) => {
        setDone((current) =>
          current.includes(id) ? current.filter((each) => each !== id) : [...current, id],
        );
      }}
      onContinue={() => {
        router.push('/home');
      }}
    />
  );
}
