import { useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Banner, BodyText, Button, Card, Heading, Label, Screen } from '@fieldforce/ui';
import { takeFix } from '../../src/capture/location';

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
 */
export default function LocationRationale(): ReactNode {
  const router = useRouter();
  const [outcome, setOutcome] = useState<string | null>(null);

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

      <Button
        label="Turn location on"
        onPress={() => {
          // The only path in the app that raises the prompt outside a check-in, and
          // it is an explicit user request — the single trigger
          // `shouldPromptForLocation` allows.
          void takeFix().then((fix) => {
            setOutcome(
              fix.kind === 'fix'
                ? 'Location is on. Your check-ins will record where you were.'
                : 'Location is still off. Everything in the app keeps working; check-ins just cannot record a position yet.',
            );
          });
        }}
        variant="secondary"
      />

      <Button
        label="Not now"
        onPress={() => {
          router.back();
        }}
        variant="secondary"
      />
    </Screen>
  );
}
