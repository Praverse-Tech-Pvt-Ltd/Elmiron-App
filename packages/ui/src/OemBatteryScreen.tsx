import type { ReactNode } from 'react';
import { Banner } from './Banner';
import { BodyText, Heading, Label } from './Text';
import { PrimaryButton } from './PrimaryButton';
import { Screen } from './Screen';
import { SetupStepList } from './SetupStepList';
import type { SetupStepView } from './SetupStepList';

/**
 * Screens A5-A8: the per-OEM battery setup, one component, four sets of words.
 *
 * The four screens differ only in copy and steps, so they are one component. Writing
 * four near-identical files is how the Vivo screen ends up with a fix the Realme one
 * never gets — the same argument as keeping every component in this package.
 *
 * **Renders usefully with zero shortcuts.** Nothing on this screen is conditional on
 * an intent resolving except the shortcut buttons themselves. That is the designed
 * state, not a degraded one: on this build no vendor deep link is expressible at all,
 * so every device sees the numbered-steps version and it has to be the good version.
 */

export interface OemBatteryScreenProps {
  /** "MIUI / HyperOS". Names the skin, because the MR's phone does. */
  readonly skin: string;
  readonly headline: string;
  /** What happens to their own day if they skip this. */
  readonly consequence: string;
  readonly steps: readonly SetupStepView[];
  readonly onToggleDone: (id: string) => void;
  /**
   * The result of the last shortcut press, in words, or `null`.
   *
   * A failed settings launch is a normal outcome and is reported as an ordinary line,
   * never as a critical banner — see `BannerTone`. The MR has done nothing wrong and
   * the steps still work.
   */
  readonly notice?: string | null;
  /**
   * THE 20-SECOND VIDEOS DO NOT EXIST.
   *
   * The design offers "Show me a 20-second video" on each of these screens. No asset
   * has been produced, and there is no third-party link to fall back on — putting
   * these steps on YouTube would send an MR's device identity to Google on the first
   * run of an app whose whole premise is careful handling of what it collects.
   *
   * So the control renders **disabled, with a label that says why**, rather than
   * being omitted. Omitting it would leave no trace that a designed element is
   * missing, and the next person to read this screen against Phase 2 would have to
   * work out whether it was dropped deliberately. A disabled control with honest
   * wording says "this is coming and it is not here", which is true.
   *
   * Defaults to `false`. Shipping the asset is this flag plus a handler.
   */
  readonly videoAvailable?: boolean;
  readonly onWatchVideo?: () => void;
  readonly onContinue: () => void;
  readonly continueLabel?: string;
}

const VIDEO_PENDING_LABEL = '20-second video — not recorded yet';

export const OemBatteryScreen = ({
  skin,
  headline,
  consequence,
  steps,
  onToggleDone,
  notice = null,
  videoAvailable = false,
  onWatchVideo,
  onContinue,
  continueLabel = 'Continue',
}: OemBatteryScreenProps): ReactNode => (
  <Screen scrollable>
    <Label muted>{skin}</Label>
    <Heading>{headline}</Heading>

    {/*
      The consequence is body text, not a warning banner. It is a true statement about
      the MR's day, and dressing it as an alert on a first-run screen is how an app
      teaches people that its alerts mean nothing — the rule stated on `BannerTone`.
    */}
    <BodyText>{consequence}</BodyText>

    <SetupStepList steps={steps} onToggleDone={onToggleDone} />

    {notice === null ? null : <Banner tone="info" title={notice} />}

    <PrimaryButton
      label={videoAvailable ? 'Show me a 20-second video' : VIDEO_PENDING_LABEL}
      disabled={!videoAvailable}
      onPress={() => {
        onWatchVideo?.();
      }}
    />

    {/*
      Always enabled. The MR may leave this screen with nothing marked done and
      nothing opened — these settings are a recommendation the app cannot enforce, and
      trapping someone on an onboarding screen until they satisfy it is the coercive
      shape S4 exists to avoid.
    */}
    <PrimaryButton label={continueLabel} onPress={onContinue} />
  </Screen>
);
