import { useState } from 'react';
import type { ReactNode } from 'react';
import { PermissionsAndroid } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner,
  BodyText,
  Button,
  Card,
  Display,
  Label,
  Screen,
  t,
  useLanguage,
} from '@fieldforce/ui';
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
  useLanguage();
  const router = useRouter();
  // `FE-W155`. Which answer came back, not its sentence: the words are read at render.
  const [outcome, setOutcome] = useState<'granted' | 'unanswered' | null>(null);

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
    <Screen scrollable>
      <Display>{t('onboarding.locationHeadline')}</Display>
      <BodyText muted>{t('onboarding.locationLead')}</BodyText>

      <Card>
        <BodyText>{t('onboarding.locationOneTap')}</BodyText>
        <Label muted>{t('onboarding.locationOneTapDetail')}</Label>
      </Card>

      <Card>
        <BodyText>{t('onboarding.locationMileage')}</BodyText>
        <Label muted>{t('onboarding.locationMileageDetail')}</Label>
      </Card>

      <Card tone="hero">
        <BodyText>{t('onboarding.locationOnlyPress')}</BodyText>
        <Label muted>{t('onboarding.locationOnlyPressDetail')}</Label>
      </Card>

      {outcome === null ? null : (
        <Banner
          detail={
            outcome === 'granted' ? t('onboarding.locationOn') : t('onboarding.locationUnanswered')
          }
          title={t('settings.location')}
          tone="info"
        />
      )}

      <Button
        label={t('onboarding.seeRecorded')}
        onPress={() => {
          router.push('/transparency');
        }}
        variant="quiet"
      />

      {/*
        An explicit user request — the single trigger `shouldPromptForLocation` allows. The
        design lists it before "Not now"; the two stay the same weight.
      */}
      <Button label={t('onboarding.turnLocationOn')} onPress={turnOn} variant="secondary" />

      <Button label={t('onboarding.notNow')} onPress={carryOn} variant="secondary" />
    </Screen>
  );
}
