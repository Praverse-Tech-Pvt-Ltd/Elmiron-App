import type { ReactNode } from 'react';
import { Banner, BodyText, Heading, Screen } from '@fieldforce/ui';

/**
 * The Coaching tab, deliberately empty.
 *
 * **`frontend-plan-v2.md` §3.6 forbids "any screen that displays a transcript,
 * analysis or AI summary" and calls it a regulatory line rather than a
 * preference.** That was put to a human on 2 September 2026 and the line was
 * upheld — recorded in `fe-w3-spec.md` §4a. So this tab exists, because B1's bar
 * has four destinations and a missing one would be a hole, and it says what it is
 * rather than pretending the feature is merely unfinished.
 *
 * `packages/ui` already contains `CitationSpan`, `FindingCard` and
 * `OverrideControl`, built and tested during Phase 1. They render nothing anywhere
 * in this app and this file is not the place to change that. If the line moves,
 * the decision is recorded in §4a and this screen is where the work starts.
 */
export default function Coaching(): ReactNode {
  return (
    <Screen scrollable>
      <Heading>Coaching</Heading>
      <Banner
        detail="Coaching notes are built on recordings and their analysis. That work is on hold, and this app does not show a transcript, an analysis or an AI summary anywhere."
        title="Not available in this build"
        tone="info"
      />
      <BodyText muted>
        When it arrives, you will see a manager’s note next to the moment it refers to, with the
        recording it came from, and you will be able to reply before anyone acts on it.
      </BodyText>
    </Screen>
  );
}
