import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { BodyText, Button, Heading, Label, Screen } from '@fieldforce/ui';

/**
 * A4 — the microphone, asked at the first real visit and never at sign-in.
 *
 * **Two design decisions are load-bearing here. Neither is cosmetic.**
 *
 * **1. The deferral.** Asking for a microphone before the MR has seen a single
 * benefit is the abandonment moment. This route is reached from a visit that has
 * already started — `shouldPromptForMicrophone` in `src/onboarding/permissions.ts`
 * returns false for `'sign-in'` and that is asserted by a test.
 *
 * **2. The separation, which must not be collapsed into one line.** The MR's own
 * voice note and recording a consultation are different things with different
 * consents, and this screen is where an MR learns that. Merging them into a single
 * friendly sentence about "recording" is how the app earns a surveillance reputation
 * on day one — and it would be inaccurate: a note the MR holds a button to dictate
 * has no third party in it, while a consultation recording needs the doctor to agree,
 * every time, and is governed by the consent flow in plan W6.
 *
 * If a future edit shortens this screen, the two paragraphs below are the ones that
 * have to survive.
 *
 * **Both actions carry the same weight.** Consenting to a microphone is not the
 * outcome this screen is steering towards — it is the one the MR is being given
 * enough information to choose. Sibling screens (`notifications`, `location-denied`)
 * make the same claim and resolve it the same way.
 *
 * **Why both are `secondary` and not both `primary`.** §04 gives a screen one
 * primary action; two filled accent buttons made this screen read as two competing
 * primaries. The resolution is §05's own worked example — `OverrideControl` renders
 * Agree and Disagree as two identical `secondary` controls, because a genuine
 * either/or has no single action the app is pushing. Equal weight is preserved
 * exactly; what is dropped is the false claim that either answer is *the* thing to
 * do here.
 */
export default function MicrophoneRationale(): ReactNode {
  const router = useRouter();
  const next = (): void => {
    router.back();
  };

  return (
    <Screen scrollable>
      <Heading>Your note, in your own words</Heading>

      <BodyText>
        Your note is yours. It records only while you hold the button, and it stops the moment you
        let go.
      </BodyText>

      {/*
        A separate block, with its own label. The visual separation is the point: these
        two sentences must not read as one continuous description of "recording".
      */}
      <Label muted>Recording a consultation is separate</Label>
      <BodyText>
        Recording a consultation is a different thing. That needs the doctor to agree, every time,
        and you will be asked about it there — not here.
      </BodyText>

      <Button label="Allow the microphone" onPress={next} variant="secondary" />
      <Button label="Not now" onPress={next} variant="secondary" />
    </Screen>
  );
}
