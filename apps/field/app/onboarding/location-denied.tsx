import { useState } from 'react';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import {
  BodyText,
  Button,
  Display,
  Label,
  Screen,
  Secondary,
  t,
  useLanguage,
} from '@fieldforce/ui';
import { useBack } from '../../src/navigation/back';
import { batteryStepApplies } from '../../src/onboarding/device';
import { firstRunPosition, useInFirstRun } from '../../src/onboarding/first-run';
import { requestLocationPermission } from '../../src/onboarding/location-permission';
import { requestLocationAnswers } from '../../src/onboarding/os-permissions';
import { hasCompletedFirstRun } from '../../src/onboarding/progress';

/**
 * S4 — location denied.
 *
 * **A destination, not an interruption.** There is no launch check, no timer, no focus effect and
 * no banner on other screens that leads here — see the three rules in
 * `src/onboarding/permissions.ts`, each with a test.
 *
 * **FE-D2 — one route in, and it is the rep's own answer (operator ruling).** A rep who presses
 * "Turn location on" on A2 and says no lands here, once, as the response to that press. That is
 * not a nag: nothing brings them back here later, and nothing re-asks unless they press
 * "Turn location back on".
 *
 * **"Turn location back on" asks again** (`explicit-user-request`, the one trigger
 * `shouldPromptForLocation` allows). If Android answers "never ask again" it will not show the
 * prompt, so this opens the app's system settings instead of asking into silence (operator
 * ruling). Foreground only; never background.
 *
 * **Two equal actions, and they are equal in the markup, not just in the copy.** Both
 * are the same `Button` variant. Rendering "Carry on by hand" as the quieter of the
 * two while "Turn location back on" gets the filled accent is exactly the coercion
 * this screen is designed not to be — the design says two equal actions, and a
 * visual hierarchy would be the app arguing with the MR's decision after claiming to
 * accept it.
 *
 * **Why both are `secondary` and not both `primary`.** §04 gives a screen one
 * primary action; two filled accent buttons made this screen read as two competing
 * primaries. The resolution is §05's own worked example — `OverrideControl` renders
 * Agree and Disagree as two identical `secondary` controls, because a genuine
 * either/or has no single action the app is pushing. Equal weight is preserved
 * exactly; what is dropped is the false claim that either answer is *the* thing to
 * do here.
 *
 * Carrying on by hand is a working path. Manual check-in is first-class
 * (`checkInMethodsFor` returns it whatever the permission state), no route is blocked,
 * and the app does not degrade. That is what makes the re-ask above it honest rather
 * than a lever.
 */
export default function LocationDenied(): ReactNode {
  useLanguage();
  const router = useRouter();
  const back = useBack();
  // `FE-W155`. Which answer came back, not its sentence: the words are read at render.
  const [note, setNote] = useState<'denied' | 'unanswered' | null>(null);
  /** `FE-W192`. A branch of first run's first step: "Step 1 of N" there, a Back from Me. */
  const inFirstRun = useInFirstRun();

  /** On to A3 in first run; back where they came from otherwise. */
  const carryOn = (): void => {
    void hasCompletedFirstRun().then((done) => {
      if (done) router.back();
      else router.push('/onboarding/notifications');
    });
  };

  const turnBackOn = (): void => {
    setNote(null);
    void requestLocationPermission({
      requestMultiple: requestLocationAnswers,
    }).then((answer) => {
      switch (answer) {
        case 'granted':
          carryOn();
          return;
        case 'blocked':
          // Android will not show the prompt again. The setting is the only way back.
          void Linking.openSettings();
          return;
        case 'denied':
          setNote('denied');
          return;
        case 'unanswered':
          setNote('unanswered');
          return;
      }
    });
  };

  return (
    <Screen scrollable {...(inFirstRun === false ? { onBack: back } : {})}>
      {inFirstRun === true ? (
        <Label muted>
          {t('onboarding.stepOf', firstRunPosition('location', batteryStepApplies()))}
        </Label>
      ) : null}
      <Display>{t('onboarding.deniedHeadline')}</Display>

      <BodyText>{t('onboarding.deniedBody')}</BodyText>

      {/*
        THE NUMBERS ARE THE DESIGN'S ESTIMATES AND ARE LABELLED AS SUCH.

        14 minutes and ₹600 come from Phase 2. Nothing in this repository measured
        them, no MR has been timed, and no claim data has been analysed — the mock
        service is fixtures. Presenting an estimate as a measurement to the person
        whose own day it describes is the fastest way to lose them: an MR who finds it
        is not 14 minutes stops believing the rest of the screen too.

        Remove this line only when someone has actually measured it.
      */}
      {/* `FE-W189`. Sentences, so the prose step (`Secondary`), not the label step. */}
      <Secondary>{t('onboarding.deniedEstimate')}</Secondary>

      {note === null ? null : (
        <Secondary>
          {note === 'denied' ? t('onboarding.stillOff') : t('onboarding.unanswered')}
        </Secondary>
      )}

      <Button label={t('onboarding.turnBackOn')} variant="secondary" onPress={turnBackOn} />
      <Button label={t('onboarding.byHand')} variant="secondary" onPress={carryOn} />
    </Screen>
  );
}
