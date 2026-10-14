import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import {
  Banner,
  BodyText,
  Button,
  Card,
  Display,
  Label,
  Screen,
  Secondary,
  t,
  useLanguage,
} from '@fieldforce/ui';
import { liveTrackingEnabled } from '../../src/features';
import { useBack } from '../../src/navigation/back';
import { batteryStepApplies } from '../../src/onboarding/device';
import { firstRunPosition, useInFirstRun } from '../../src/onboarding/first-run';
import { locationClaim } from '../../src/onboarding/location-claim';
import { requestLocationPermission } from '../../src/onboarding/location-permission';
import {
  locationAlreadyGranted,
  requestLocationAnswers,
} from '../../src/onboarding/os-permissions';
import { hasCompletedFirstRun } from '../../src/onboarding/progress';
import { useLiveTracker } from '../../src/tracking/tracker';

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
 * **`FE-W185`. Unless live location is in the build.** Then that third promise was false for a rep
 * sharing live location, so the card's words come from `locationClaim`: the same promise where it
 * holds, and where it does not, exactly when else a position is read.
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
  useLanguage();
  const router = useRouter();
  const back = useBack();
  // `FE-W155`. Which answer came back, not its sentence: the words are read at render.
  const [outcome, setOutcome] = useState<'granted' | 'unanswered' | null>(null);
  /** `FE-W192`. In first run (step line, no Back), or opened from Me (Back, no step line). */
  const inFirstRun = useInFirstRun();
  const tracker = useLiveTracker();
  const claim = locationClaim({
    liveBuild: liveTrackingEnabled,
    trackerState: tracker?.state ?? null,
  });

  /**
   * `FE-W192`. Location may already be allowed — the screen reached again from Me, or a reinstall
   * that kept the grant. Asking "Turn location on" then was a question already answered, so the
   * screen says it is on and offers the one way on.
   */
  const [alreadyOn, setAlreadyOn] = useState(false);
  useEffect(() => {
    let live = true;
    void locationAlreadyGranted().then((granted) => {
      if (live) setAlreadyOn(granted);
    });
    return () => {
      live = false;
    };
  }, []);
  const granted = alreadyOn || outcome === 'granted';

  /** On to A3 in first run; back where they came from otherwise. */
  const carryOn = (): void => {
    void hasCompletedFirstRun().then((done) => {
      if (done) router.back();
      else router.push('/onboarding/notifications');
    });
  };

  const turnOn = (): void => {
    void requestLocationPermission({
      requestMultiple: requestLocationAnswers,
    }).then(async (answer) => {
      switch (answer) {
        case 'granted':
          if (await hasCompletedFirstRun()) {
            setOutcome('granted');
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
          setOutcome('unanswered');
          return;
      }
    });
  };

  return (
    // `FE-W188`. Opened from Me it is a pushed screen with a way back; in first run there is no
    // "back" to offer — the way on is one of its answers.
    <Screen scrollable {...(inFirstRun === false ? { onBack: back } : {})}>
      {inFirstRun === true ? (
        <Label muted>
          {t('onboarding.stepOf', firstRunPosition('location', batteryStepApplies()))}
        </Label>
      ) : null}
      <Display>{t('onboarding.locationHeadline')}</Display>
      <BodyText muted>{t('onboarding.locationLead')}</BodyText>

      {/* `FE-W189`. Each card's second line is a sentence, so it is set at the prose step. */}
      <Card>
        <BodyText>{t('onboarding.locationOneTap')}</BodyText>
        <Secondary>{t('onboarding.locationOneTapDetail')}</Secondary>
      </Card>

      <Card>
        <BodyText>{t('onboarding.locationMileage')}</BodyText>
        <Secondary>{t('onboarding.locationMileageDetail')}</Secondary>
      </Card>

      {/* `FE-W185`. When a position is read, worded for this phone: see `locationClaim`. */}
      <Card tone="hero">
        <BodyText>{t(claim.title)}</BodyText>
        <Secondary>{t(claim.detail)}</Secondary>
      </Card>

      {granted ? (
        <Banner detail={t('onboarding.locationOn')} title={t('settings.location')} tone="info" />
      ) : outcome === 'unanswered' ? (
        <Banner
          detail={t('onboarding.locationUnanswered')}
          title={t('settings.location')}
          tone="info"
        />
      ) : null}

      <Button
        label={t('onboarding.seeRecorded')}
        onPress={() => {
          router.push('/transparency');
        }}
        variant="quiet"
      />

      {granted ? (
        /*
          `FE-W192`. Nothing left to answer, so one way on, as the screen's one primary: on to the
          next step in first run, back to Me otherwise.
        */
        <Button
          label={inFirstRun === true ? t('onboarding.continue') : t('onboarding.done')}
          onPress={() => {
            if (inFirstRun === true) router.push('/onboarding/notifications');
            else back();
          }}
        />
      ) : (
        <>
          {/*
            An explicit user request — the single trigger `shouldPromptForLocation` allows. The
            design lists it before "Not now"; the two stay the same weight (a permission answer,
            so neither is a primary — `FE-W192` keeps that rule).
          */}
          <Button label={t('onboarding.turnLocationOn')} onPress={turnOn} variant="secondary" />

          <Button label={t('onboarding.notNow')} onPress={carryOn} variant="secondary" />
        </>
      )}
    </Screen>
  );
}
