import { useState } from 'react';
import type { ReactNode } from 'react';
import { PermissionsAndroid } from 'react-native';
import { useRouter } from 'expo-router';
import { Banner, BodyText, Button, Card, Heading, Label, Screen } from '@fieldforce/ui';
import { requestLocationPermission } from '../../src/onboarding/location-permission';
import { hasCompletedFirstRun } from '../../src/onboarding/progress';

/**
 * A2 — the location rationale, and the only place this app asks for location
 * without an in-progress check-in.
 *
 * **Two of the design's three benefits are not true of this build, so they are not
 * written.** A2 promises "Checked in automatically — walk in, it logs itself" and
 * "The nearest doctor you've missed". Both need a position while the app is closed
 * or merely open, and `fe-w3-spec.md` §4a settled that as discrete fixes only. An
 * MR who granted location on the strength of automatic check-in and then found
 * themselves still pressing a button would be right to feel misled, and would be
 * less likely to believe the next screen.
 *
 * What replaces them is narrower and true, and the third promise is *stronger*
 * under that decision than the design's own "only during your shift": this app
 * cannot take a position at any other time, because it never asks the operating
 * system for one.
 *
 * **"Not now" is the same weight as "Turn location on".** The design says so — "an
 * MR who feels cornered here uninstalls" — and the same rule already governs the
 * microphone and notification screens.
 *
 * **FE-D2 — A2 is first run's second screen again (operator ruling: the design's order).** It is
 * reached two ways and behaves accordingly, read off disk as `transparency.tsx` does:
 *   - in FIRST RUN, both answers go on to A3 (notifications); a denial lands on S4 first;
 *   - from ME, "Not now" goes back and a grant says so here, as before.
 * The ask is `PermissionsAndroid`, foreground only, and **reads no position** — it used to call
 * `takeFix`, which took a fix at onboarding. See `location-permission.ts`.
 */
export default function LocationRationale(): ReactNode {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string | null>(null);

  /** On to A3 in first run; back where they came from otherwise. */
  const carryOn = (): void => {
    void hasCompletedFirstRun().then((done) => {
      if (done) router.back();
      else router.push('/onboarding/notifications');
    });
  };

  const turnOn = (): void => {
    void requestLocationPermission({
      requestMultiple: (permissions) => PermissionsAndroid.requestMultiple(permissions),
    }).then(async (answer) => {
      switch (answer) {
        case 'granted':
          if (await hasCompletedFirstRun()) {
            setOutcome('Location is on. Your check-ins will record where you were.');
          } else {
            router.push('/onboarding/notifications');
          }
          return;
        case 'denied':
        case 'blocked':
          // Operator ruling: S4 is where the rep lands when location is denied.
          router.push('/onboarding/location-denied');
          return;
        case 'unanswered':
          setOutcome(
            'The phone did not show the question. Nothing has changed; you can try again, or carry on — everything works without location.',
          );
          return;
      }
    });
  };

  return (
    <Screen scrollable>
      <Heading>Stop filling in where you were.</Heading>
      <BodyText muted>Turn location on and two things stop being your job.</BodyText>

      <Card>
        <BodyText>Check in with one tap</BodyText>
        <Label muted>
          Press the button and where you were is recorded with it. No writing the clinic name into a
          form in the waiting room.
        </Label>
      </Card>

      <Card>
        <BodyText>Mileage adds itself up</BodyText>
        <Label muted>
          Distance between the visits you checked into goes onto your claim. It is measured in
          straight lines, so it under-counts real roads rather than over-counting them.
        </Label>
      </Card>

      <Card tone="hero">
        <BodyText>Only when you press check in or check out</BodyText>
        <Label muted>
          Not in the background, not while you walk, not after your shift. This app never asks your
          phone for a position at any other moment.
        </Label>
      </Card>

      {outcome === null ? null : <Banner detail={outcome} title="Location" tone="info" />}

      <Button
        label="See exactly what's recorded"
        onPress={() => {
          router.push('/transparency');
        }}
        variant="quiet"
      />

      {/*
        An explicit user request — the single trigger `shouldPromptForLocation` allows. The
        design lists it before "Not now"; the two stay the same weight.
      */}
      <Button label="Turn location on" onPress={turnOn} variant="secondary" />

      <Button label="Not now" onPress={carryOn} variant="secondary" />
    </Screen>
  );
}
