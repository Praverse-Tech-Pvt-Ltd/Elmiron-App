import type { ReactNode } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { requestNotificationPermission } from '../../src/onboarding/notification-permission';
import { BodyText, Button, Heading, ListRow, Screen } from '@fieldforce/ui';
import { capSentence, NOTIFICATION_TYPES } from '../../src/onboarding/notifications';

/**
 * A3 — notifications, asked at sign-in.
 *
 * **The four types are named and the count is capped.** That is the whole design of
 * this screen. "Stay updated" would be a request for consent to an unbounded thing,
 * and an MR who agrees to it has agreed to nothing they could later hold us to.
 *
 * The names and the cap are rendered from `src/onboarding/notifications.ts`, which
 * records that the exact wording is derived from this codebase's features rather than
 * transcribed from Phase 2 — `docs/design/` is not in this repository. See the
 * sourcing note there before treating this copy as approved.
 *
 * Both actions leave the screen. "Not now" is not a lesser choice rendered as one:
 * notifications denied is an ordinary state, and the app has no behaviour that
 * depends on this being granted. They are the same `Button` variant for that reason.
 *
 * **Why both are `secondary` and not both `primary`.** §04 gives a screen one
 * primary action; two filled accent buttons made this screen read as two competing
 * primaries. The resolution is §05's own worked example — `OverrideControl` renders
 * Agree and Disagree as two identical `secondary` controls, because a genuine
 * either/or has no single action the app is pushing. Equal weight is preserved
 * exactly; what is dropped is the false claim that either answer is *the* thing to
 * do here.
 */
export default function NotificationsRationale(): ReactNode {
  const router = useRouter();
  const next = (): void => {
    router.push('/onboarding/battery');
  };

  /**
   * FE-D2 first run. "Allow notifications" used to call `next` and nothing else, so it asked
   * Android for nothing. It raises the system prompt now (Android 13+; below that there is no
   * permission to ask for), and continues whatever the answer: the app works without them.
   * "Not now" still calls `next` alone and requests nothing.
   */
  const allow = (): void => {
    void requestNotificationPermission({
      apiLevel: typeof Platform.Version === 'number' ? Platform.Version : 0,
      request: (permission) => PermissionsAndroid.request(permission),
    }).then(next);
  };

  return (
    <Screen scrollable>
      <Heading>What we&apos;ll send you</Heading>
      <BodyText>{capSentence()}</BodyText>

      {NOTIFICATION_TYPES.map((type) => (
        <ListRow key={type.id} title={type.name} detail={type.detail} />
      ))}

      {/*
        The rationale comes first and the system prompt only on "Allow" — showing the
        reasons after Android has already asked is the pattern that produces a reflexive
        "deny". (FE-D2: this comment said the caller raised the prompt; nothing did.)
      */}
      <Button label="Allow notifications" onPress={allow} variant="secondary" />
      <Button label="Not now" onPress={next} variant="secondary" />
    </Screen>
  );
}
