import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { BodyText, Heading, ListRow, PrimaryButton, Screen } from '@fieldforce/ui';
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
 * depends on this being granted.
 */
export default function NotificationsRationale(): ReactNode {
  const router = useRouter();
  const next = (): void => {
    router.push('/onboarding/battery');
  };

  return (
    <Screen scrollable>
      <Heading>What we&apos;ll send you</Heading>
      <BodyText>{capSentence()}</BodyText>

      {NOTIFICATION_TYPES.map((type) => (
        <ListRow key={type.id} title={type.name} detail={type.detail} />
      ))}

      {/*
        The system prompt is raised by the caller of this screen, not here. This
        screen is the rationale that precedes it — showing the reasons after Android
        has already asked is the pattern that produces a reflexive "deny".
      */}
      <PrimaryButton label="Allow notifications" onPress={next} />
      <PrimaryButton label="Not now" onPress={next} />
    </Screen>
  );
}
