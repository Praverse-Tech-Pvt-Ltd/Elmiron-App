import { useState } from 'react';
import type { ReactNode } from 'react';
import { Linking, PermissionsAndroid } from 'react-native';
import { useRouter } from 'expo-router';
import { BodyText, Button, Display, Label, Screen } from '@fieldforce/ui';
import { requestLocationPermission } from '../../src/onboarding/location-permission';
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
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);

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
      requestMultiple: (permissions) => PermissionsAndroid.requestMultiple(permissions),
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
          setNote('Location is still off. You can carry on by hand — everything works.');
          return;
        case 'unanswered':
          setNote('The phone did not show the question. Nothing has changed.');
          return;
      }
    });
  };

  return (
    <Screen scrollable>
      <Display>Location is off, so you&apos;re doing this by hand</Display>

      <BodyText>
        Check-ins need a tap each and mileage won&apos;t add itself up. That&apos;s about 14 minutes
        a day and roughly ₹600 a month you&apos;d claim manually.
      </BodyText>

      {/*
        THE NUMBERS ARE THE DESIGN'S ESTIMATES AND ARE LABELLED AS SUCH.

        14 minutes and ₹600 come from Phase 2. Nothing in this repository measured
        them, no MR has been timed, and no claim data has been analysed — the mock
        service is fixtures. Presenting an estimate as a measurement to the person
        whose own day it describes is the fastest way to lose them: an MR who finds it
        is not 14 minutes stops believing the rest of the screen too.

        Remove this line only when someone has actually measured it.
      */}
      <Label muted>Estimates from the product design, not measured from your visits.</Label>

      {note === null ? null : <Label muted>{note}</Label>}

      <Button label="Turn location back on" variant="secondary" onPress={turnBackOn} />
      <Button label="Carry on by hand" variant="secondary" onPress={carryOn} />
    </Screen>
  );
}
